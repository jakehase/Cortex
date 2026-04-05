import { createDataConsoleWorkspace, summarizeDataConsoleWorkspace, createDataConsoleNarratives, createDataConsoleCoverageGrid } from './domain-data-console.mjs';
import { createDataConsolePolicies, validateDataConsolePolicies, summarizeDataConsolePolicies, createDataConsoleEscalationDeck } from './policies-data-console.mjs';
import { createDataConsoleAnalyticsTimeline, createDataConsoleForecastEnvelope, createDataConsoleExceptionLedger, summarizeDataConsoleAnalytics } from './analytics-data-console.mjs';
import { createDataConsoleOperationsBoard, createDataConsoleShiftChecklist, createDataConsoleIncidentDeck } from './operations-data-console.mjs';
import { createDataConsoleReportCards, createDataConsoleReviewPackets, summarizeDataConsoleReporting } from './reporting-data-console.mjs';
import { createDataConsoleAuditTrail, createDataConsoleEvidenceManifest, createDataConsoleReadinessAttestation } from './audit-data-console.mjs';
import { createDataConsolePlaybooks, createDataConsoleDecisionDeck, createDataConsoleEscalationMoments } from './playbooks-data-console.mjs';

export function buildDataConsoleSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createDataConsoleWorkspace(workspaceName);
  const policies = createDataConsolePolicies();
  return {
    workspace,
    summary: summarizeDataConsoleWorkspace(workspace),
    narratives: createDataConsoleNarratives(workspace),
    coverage: createDataConsoleCoverageGrid(workspace),
    policies,
    policySummary: summarizeDataConsolePolicies(policies),
    validation: validateDataConsolePolicies(policies),
    escalationDeck: createDataConsoleEscalationDeck(policies),
    analytics: {
      timeline: createDataConsoleAnalyticsTimeline(),
      forecast: createDataConsoleForecastEnvelope(),
      exceptions: createDataConsoleExceptionLedger(),
      summary: summarizeDataConsoleAnalytics()
    },
    operations: {
      board: createDataConsoleOperationsBoard(),
      checklist: createDataConsoleShiftChecklist(),
      incidents: createDataConsoleIncidentDeck()
    },
    reporting: {
      cards: createDataConsoleReportCards(),
      packets: createDataConsoleReviewPackets(),
      summary: summarizeDataConsoleReporting()
    },
    audit: {
      trail: createDataConsoleAuditTrail(),
      manifest: createDataConsoleEvidenceManifest(),
      attestation: createDataConsoleReadinessAttestation()
    },
    playbooks: createDataConsolePlaybooks(),
    decisions: createDataConsoleDecisionDeck(),
    escalationMoments: createDataConsoleEscalationMoments()
  };
}

export function createDataConsoleReadinessBoard(snapshot = buildDataConsoleSnapshot()) {
  return [
    { id: 'data-console-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'data-console-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'data-console-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'data-console-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createDataConsoleApiDocument(snapshot = buildDataConsoleSnapshot()) {
  return {
    id: 'data-console-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/data-console/overview' },
      { method: 'GET', path: '/api/data-console/reporting' },
      { method: 'POST', path: '/api/data-console/validate' },
      { method: 'GET', path: '/api/data-console/audit' }
    ],
    readiness: createDataConsoleReadinessBoard(snapshot)
  };
}

export function createDataConsoleRouteSummary(snapshot = buildDataConsoleSnapshot()) {
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

