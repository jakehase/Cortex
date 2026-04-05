import { createInsightsConsoleWorkspace, summarizeInsightsConsoleWorkspace, createInsightsConsoleNarratives, createInsightsConsoleCoverageGrid } from './domain-insights-console.mjs';
import { createInsightsConsolePolicies, validateInsightsConsolePolicies, summarizeInsightsConsolePolicies, createInsightsConsoleEscalationDeck } from './policies-insights-console.mjs';
import { createInsightsConsoleAnalyticsTimeline, createInsightsConsoleForecastEnvelope, createInsightsConsoleExceptionLedger, summarizeInsightsConsoleAnalytics } from './analytics-insights-console.mjs';
import { createInsightsConsoleOperationsBoard, createInsightsConsoleShiftChecklist, createInsightsConsoleIncidentDeck } from './operations-insights-console.mjs';
import { createInsightsConsoleReportCards, createInsightsConsoleReviewPackets, summarizeInsightsConsoleReporting } from './reporting-insights-console.mjs';
import { createInsightsConsoleAuditTrail, createInsightsConsoleEvidenceManifest, createInsightsConsoleReadinessAttestation } from './audit-insights-console.mjs';
import { createInsightsConsolePlaybooks, createInsightsConsoleDecisionDeck, createInsightsConsoleEscalationMoments } from './playbooks-insights-console.mjs';

export function buildInsightsConsoleSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createInsightsConsoleWorkspace(workspaceName);
  const policies = createInsightsConsolePolicies();
  return {
    workspace,
    summary: summarizeInsightsConsoleWorkspace(workspace),
    narratives: createInsightsConsoleNarratives(workspace),
    coverage: createInsightsConsoleCoverageGrid(workspace),
    policies,
    policySummary: summarizeInsightsConsolePolicies(policies),
    validation: validateInsightsConsolePolicies(policies),
    escalationDeck: createInsightsConsoleEscalationDeck(policies),
    analytics: {
      timeline: createInsightsConsoleAnalyticsTimeline(),
      forecast: createInsightsConsoleForecastEnvelope(),
      exceptions: createInsightsConsoleExceptionLedger(),
      summary: summarizeInsightsConsoleAnalytics()
    },
    operations: {
      board: createInsightsConsoleOperationsBoard(),
      checklist: createInsightsConsoleShiftChecklist(),
      incidents: createInsightsConsoleIncidentDeck()
    },
    reporting: {
      cards: createInsightsConsoleReportCards(),
      packets: createInsightsConsoleReviewPackets(),
      summary: summarizeInsightsConsoleReporting()
    },
    audit: {
      trail: createInsightsConsoleAuditTrail(),
      manifest: createInsightsConsoleEvidenceManifest(),
      attestation: createInsightsConsoleReadinessAttestation()
    },
    playbooks: createInsightsConsolePlaybooks(),
    decisions: createInsightsConsoleDecisionDeck(),
    escalationMoments: createInsightsConsoleEscalationMoments()
  };
}

export function createInsightsConsoleReadinessBoard(snapshot = buildInsightsConsoleSnapshot()) {
  return [
    { id: 'insights-console-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'insights-console-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'insights-console-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'insights-console-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createInsightsConsoleApiDocument(snapshot = buildInsightsConsoleSnapshot()) {
  return {
    id: 'insights-console-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/insights-console/overview' },
      { method: 'GET', path: '/api/insights-console/reporting' },
      { method: 'POST', path: '/api/insights-console/validate' },
      { method: 'GET', path: '/api/insights-console/audit' }
    ],
    readiness: createInsightsConsoleReadinessBoard(snapshot)
  };
}

export function createInsightsConsoleRouteSummary(snapshot = buildInsightsConsoleSnapshot()) {
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

