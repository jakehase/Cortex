import { createAutomationConsoleWorkspace, summarizeAutomationConsoleWorkspace, createAutomationConsoleNarratives, createAutomationConsoleCoverageGrid } from './domain-automation-console.mjs';
import { createAutomationConsolePolicies, validateAutomationConsolePolicies, summarizeAutomationConsolePolicies, createAutomationConsoleEscalationDeck } from './policies-automation-console.mjs';
import { createAutomationConsoleAnalyticsTimeline, createAutomationConsoleForecastEnvelope, createAutomationConsoleExceptionLedger, summarizeAutomationConsoleAnalytics } from './analytics-automation-console.mjs';
import { createAutomationConsoleOperationsBoard, createAutomationConsoleShiftChecklist, createAutomationConsoleIncidentDeck } from './operations-automation-console.mjs';
import { createAutomationConsoleReportCards, createAutomationConsoleReviewPackets, summarizeAutomationConsoleReporting } from './reporting-automation-console.mjs';
import { createAutomationConsoleAuditTrail, createAutomationConsoleEvidenceManifest, createAutomationConsoleReadinessAttestation } from './audit-automation-console.mjs';
import { createAutomationConsolePlaybooks, createAutomationConsoleDecisionDeck, createAutomationConsoleEscalationMoments } from './playbooks-automation-console.mjs';

export function buildAutomationConsoleSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createAutomationConsoleWorkspace(workspaceName);
  const policies = createAutomationConsolePolicies();
  return {
    workspace,
    summary: summarizeAutomationConsoleWorkspace(workspace),
    narratives: createAutomationConsoleNarratives(workspace),
    coverage: createAutomationConsoleCoverageGrid(workspace),
    policies,
    policySummary: summarizeAutomationConsolePolicies(policies),
    validation: validateAutomationConsolePolicies(policies),
    escalationDeck: createAutomationConsoleEscalationDeck(policies),
    analytics: {
      timeline: createAutomationConsoleAnalyticsTimeline(),
      forecast: createAutomationConsoleForecastEnvelope(),
      exceptions: createAutomationConsoleExceptionLedger(),
      summary: summarizeAutomationConsoleAnalytics()
    },
    operations: {
      board: createAutomationConsoleOperationsBoard(),
      checklist: createAutomationConsoleShiftChecklist(),
      incidents: createAutomationConsoleIncidentDeck()
    },
    reporting: {
      cards: createAutomationConsoleReportCards(),
      packets: createAutomationConsoleReviewPackets(),
      summary: summarizeAutomationConsoleReporting()
    },
    audit: {
      trail: createAutomationConsoleAuditTrail(),
      manifest: createAutomationConsoleEvidenceManifest(),
      attestation: createAutomationConsoleReadinessAttestation()
    },
    playbooks: createAutomationConsolePlaybooks(),
    decisions: createAutomationConsoleDecisionDeck(),
    escalationMoments: createAutomationConsoleEscalationMoments()
  };
}

export function createAutomationConsoleReadinessBoard(snapshot = buildAutomationConsoleSnapshot()) {
  return [
    { id: 'automation-console-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'automation-console-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'automation-console-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'automation-console-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createAutomationConsoleApiDocument(snapshot = buildAutomationConsoleSnapshot()) {
  return {
    id: 'automation-console-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/automation-console/overview' },
      { method: 'GET', path: '/api/automation-console/reporting' },
      { method: 'POST', path: '/api/automation-console/validate' },
      { method: 'GET', path: '/api/automation-console/audit' }
    ],
    readiness: createAutomationConsoleReadinessBoard(snapshot)
  };
}

export function createAutomationConsoleRouteSummary(snapshot = buildAutomationConsoleSnapshot()) {
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

