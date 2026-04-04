import { createAnalyticsConsoleWorkspace, summarizeAnalyticsConsoleWorkspace, createAnalyticsConsoleNarratives, createAnalyticsConsoleCoverageGrid } from './domain-analytics-console.mjs';
import { createAnalyticsConsolePolicies, validateAnalyticsConsolePolicies, summarizeAnalyticsConsolePolicies, createAnalyticsConsoleEscalationDeck } from './policies-analytics-console.mjs';
import { createAnalyticsConsoleAnalyticsTimeline, createAnalyticsConsoleForecastEnvelope, createAnalyticsConsoleExceptionLedger, summarizeAnalyticsConsoleAnalytics } from './analytics-analytics-console.mjs';
import { createAnalyticsConsoleOperationsBoard, createAnalyticsConsoleShiftChecklist, createAnalyticsConsoleIncidentDeck } from './operations-analytics-console.mjs';
import { createAnalyticsConsoleReportCards, createAnalyticsConsoleReviewPackets, summarizeAnalyticsConsoleReporting } from './reporting-analytics-console.mjs';
import { createAnalyticsConsoleAuditTrail, createAnalyticsConsoleEvidenceManifest, createAnalyticsConsoleReadinessAttestation } from './audit-analytics-console.mjs';
import { createAnalyticsConsolePlaybooks, createAnalyticsConsoleDecisionDeck, createAnalyticsConsoleEscalationMoments } from './playbooks-analytics-console.mjs';

export function buildAnalyticsConsoleSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createAnalyticsConsoleWorkspace(workspaceName);
  const policies = createAnalyticsConsolePolicies();
  return {
    workspace,
    summary: summarizeAnalyticsConsoleWorkspace(workspace),
    narratives: createAnalyticsConsoleNarratives(workspace),
    coverage: createAnalyticsConsoleCoverageGrid(workspace),
    policies,
    policySummary: summarizeAnalyticsConsolePolicies(policies),
    validation: validateAnalyticsConsolePolicies(policies),
    escalationDeck: createAnalyticsConsoleEscalationDeck(policies),
    analytics: {
      timeline: createAnalyticsConsoleAnalyticsTimeline(),
      forecast: createAnalyticsConsoleForecastEnvelope(),
      exceptions: createAnalyticsConsoleExceptionLedger(),
      summary: summarizeAnalyticsConsoleAnalytics()
    },
    operations: {
      board: createAnalyticsConsoleOperationsBoard(),
      checklist: createAnalyticsConsoleShiftChecklist(),
      incidents: createAnalyticsConsoleIncidentDeck()
    },
    reporting: {
      cards: createAnalyticsConsoleReportCards(),
      packets: createAnalyticsConsoleReviewPackets(),
      summary: summarizeAnalyticsConsoleReporting()
    },
    audit: {
      trail: createAnalyticsConsoleAuditTrail(),
      manifest: createAnalyticsConsoleEvidenceManifest(),
      attestation: createAnalyticsConsoleReadinessAttestation()
    },
    playbooks: createAnalyticsConsolePlaybooks(),
    decisions: createAnalyticsConsoleDecisionDeck(),
    escalationMoments: createAnalyticsConsoleEscalationMoments()
  };
}

export function createAnalyticsConsoleReadinessBoard(snapshot = buildAnalyticsConsoleSnapshot()) {
  return [
    { id: 'analytics-console-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'analytics-console-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'analytics-console-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'analytics-console-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createAnalyticsConsoleApiDocument(snapshot = buildAnalyticsConsoleSnapshot()) {
  return {
    id: 'analytics-console-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/analytics-console/overview' },
      { method: 'GET', path: '/api/analytics-console/reporting' },
      { method: 'POST', path: '/api/analytics-console/validate' },
      { method: 'GET', path: '/api/analytics-console/audit' }
    ],
    readiness: createAnalyticsConsoleReadinessBoard(snapshot)
  };
}

export function createAnalyticsConsoleRouteSummary(snapshot = buildAnalyticsConsoleSnapshot()) {
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

