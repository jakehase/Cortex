import { createAttributionConsoleWorkspace, summarizeAttributionConsoleWorkspace, createAttributionConsoleNarratives, createAttributionConsoleCoverageGrid } from './domain-attribution-console.mjs';
import { createAttributionConsolePolicies, validateAttributionConsolePolicies, summarizeAttributionConsolePolicies, createAttributionConsoleEscalationDeck } from './policies-attribution-console.mjs';
import { createAttributionConsoleAnalyticsTimeline, createAttributionConsoleForecastEnvelope, createAttributionConsoleExceptionLedger, summarizeAttributionConsoleAnalytics } from './analytics-attribution-console.mjs';
import { createAttributionConsoleOperationsBoard, createAttributionConsoleShiftChecklist, createAttributionConsoleIncidentDeck } from './operations-attribution-console.mjs';
import { createAttributionConsoleReportCards, createAttributionConsoleReviewPackets, summarizeAttributionConsoleReporting } from './reporting-attribution-console.mjs';
import { createAttributionConsoleAuditTrail, createAttributionConsoleEvidenceManifest, createAttributionConsoleReadinessAttestation } from './audit-attribution-console.mjs';
import { createAttributionConsolePlaybooks, createAttributionConsoleDecisionDeck, createAttributionConsoleEscalationMoments } from './playbooks-attribution-console.mjs';

export function buildAttributionConsoleSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createAttributionConsoleWorkspace(workspaceName);
  const policies = createAttributionConsolePolicies();
  return {
    workspace,
    summary: summarizeAttributionConsoleWorkspace(workspace),
    narratives: createAttributionConsoleNarratives(workspace),
    coverage: createAttributionConsoleCoverageGrid(workspace),
    policies,
    policySummary: summarizeAttributionConsolePolicies(policies),
    validation: validateAttributionConsolePolicies(policies),
    escalationDeck: createAttributionConsoleEscalationDeck(policies),
    analytics: {
      timeline: createAttributionConsoleAnalyticsTimeline(),
      forecast: createAttributionConsoleForecastEnvelope(),
      exceptions: createAttributionConsoleExceptionLedger(),
      summary: summarizeAttributionConsoleAnalytics()
    },
    operations: {
      board: createAttributionConsoleOperationsBoard(),
      checklist: createAttributionConsoleShiftChecklist(),
      incidents: createAttributionConsoleIncidentDeck()
    },
    reporting: {
      cards: createAttributionConsoleReportCards(),
      packets: createAttributionConsoleReviewPackets(),
      summary: summarizeAttributionConsoleReporting()
    },
    audit: {
      trail: createAttributionConsoleAuditTrail(),
      manifest: createAttributionConsoleEvidenceManifest(),
      attestation: createAttributionConsoleReadinessAttestation()
    },
    playbooks: createAttributionConsolePlaybooks(),
    decisions: createAttributionConsoleDecisionDeck(),
    escalationMoments: createAttributionConsoleEscalationMoments()
  };
}

export function createAttributionConsoleReadinessBoard(snapshot = buildAttributionConsoleSnapshot()) {
  return [
    { id: 'attribution-console-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'attribution-console-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'attribution-console-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'attribution-console-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createAttributionConsoleApiDocument(snapshot = buildAttributionConsoleSnapshot()) {
  return {
    id: 'attribution-console-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/attribution-console/overview' },
      { method: 'GET', path: '/api/attribution-console/reporting' },
      { method: 'POST', path: '/api/attribution-console/validate' },
      { method: 'GET', path: '/api/attribution-console/audit' }
    ],
    readiness: createAttributionConsoleReadinessBoard(snapshot)
  };
}

export function createAttributionConsoleRouteSummary(snapshot = buildAttributionConsoleSnapshot()) {
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

