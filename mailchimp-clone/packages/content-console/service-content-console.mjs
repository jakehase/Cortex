import { createContentConsoleWorkspace, summarizeContentConsoleWorkspace, createContentConsoleNarratives, createContentConsoleCoverageGrid } from './domain-content-console.mjs';
import { createContentConsolePolicies, validateContentConsolePolicies, summarizeContentConsolePolicies, createContentConsoleEscalationDeck } from './policies-content-console.mjs';
import { createContentConsoleAnalyticsTimeline, createContentConsoleForecastEnvelope, createContentConsoleExceptionLedger, summarizeContentConsoleAnalytics } from './analytics-content-console.mjs';
import { createContentConsoleOperationsBoard, createContentConsoleShiftChecklist, createContentConsoleIncidentDeck } from './operations-content-console.mjs';
import { createContentConsoleReportCards, createContentConsoleReviewPackets, summarizeContentConsoleReporting } from './reporting-content-console.mjs';
import { createContentConsoleAuditTrail, createContentConsoleEvidenceManifest, createContentConsoleReadinessAttestation } from './audit-content-console.mjs';
import { createContentConsolePlaybooks, createContentConsoleDecisionDeck, createContentConsoleEscalationMoments } from './playbooks-content-console.mjs';

export function buildContentConsoleSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createContentConsoleWorkspace(workspaceName);
  const policies = createContentConsolePolicies();
  return {
    workspace,
    summary: summarizeContentConsoleWorkspace(workspace),
    narratives: createContentConsoleNarratives(workspace),
    coverage: createContentConsoleCoverageGrid(workspace),
    policies,
    policySummary: summarizeContentConsolePolicies(policies),
    validation: validateContentConsolePolicies(policies),
    escalationDeck: createContentConsoleEscalationDeck(policies),
    analytics: {
      timeline: createContentConsoleAnalyticsTimeline(),
      forecast: createContentConsoleForecastEnvelope(),
      exceptions: createContentConsoleExceptionLedger(),
      summary: summarizeContentConsoleAnalytics()
    },
    operations: {
      board: createContentConsoleOperationsBoard(),
      checklist: createContentConsoleShiftChecklist(),
      incidents: createContentConsoleIncidentDeck()
    },
    reporting: {
      cards: createContentConsoleReportCards(),
      packets: createContentConsoleReviewPackets(),
      summary: summarizeContentConsoleReporting()
    },
    audit: {
      trail: createContentConsoleAuditTrail(),
      manifest: createContentConsoleEvidenceManifest(),
      attestation: createContentConsoleReadinessAttestation()
    },
    playbooks: createContentConsolePlaybooks(),
    decisions: createContentConsoleDecisionDeck(),
    escalationMoments: createContentConsoleEscalationMoments()
  };
}

export function createContentConsoleReadinessBoard(snapshot = buildContentConsoleSnapshot()) {
  return [
    { id: 'content-console-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'content-console-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'content-console-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'content-console-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createContentConsoleApiDocument(snapshot = buildContentConsoleSnapshot()) {
  return {
    id: 'content-console-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/content-console/overview' },
      { method: 'GET', path: '/api/content-console/reporting' },
      { method: 'POST', path: '/api/content-console/validate' },
      { method: 'GET', path: '/api/content-console/audit' }
    ],
    readiness: createContentConsoleReadinessBoard(snapshot)
  };
}

export function createContentConsoleRouteSummary(snapshot = buildContentConsoleSnapshot()) {
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

