import { createAdvocacyConsoleWorkspace, summarizeAdvocacyConsoleWorkspace, createAdvocacyConsoleNarratives, createAdvocacyConsoleCoverageGrid } from './domain-advocacy-console.mjs';
import { createAdvocacyConsolePolicies, validateAdvocacyConsolePolicies, summarizeAdvocacyConsolePolicies, createAdvocacyConsoleEscalationDeck } from './policies-advocacy-console.mjs';
import { createAdvocacyConsoleAnalyticsTimeline, createAdvocacyConsoleForecastEnvelope, createAdvocacyConsoleExceptionLedger, summarizeAdvocacyConsoleAnalytics } from './analytics-advocacy-console.mjs';
import { createAdvocacyConsoleOperationsBoard, createAdvocacyConsoleShiftChecklist, createAdvocacyConsoleIncidentDeck } from './operations-advocacy-console.mjs';
import { createAdvocacyConsoleReportCards, createAdvocacyConsoleReviewPackets, summarizeAdvocacyConsoleReporting } from './reporting-advocacy-console.mjs';
import { createAdvocacyConsoleAuditTrail, createAdvocacyConsoleEvidenceManifest, createAdvocacyConsoleReadinessAttestation } from './audit-advocacy-console.mjs';
import { createAdvocacyConsolePlaybooks, createAdvocacyConsoleDecisionDeck, createAdvocacyConsoleEscalationMoments } from './playbooks-advocacy-console.mjs';

export function buildAdvocacyConsoleSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createAdvocacyConsoleWorkspace(workspaceName);
  const policies = createAdvocacyConsolePolicies();
  return {
    workspace,
    summary: summarizeAdvocacyConsoleWorkspace(workspace),
    narratives: createAdvocacyConsoleNarratives(workspace),
    coverage: createAdvocacyConsoleCoverageGrid(workspace),
    policies,
    policySummary: summarizeAdvocacyConsolePolicies(policies),
    validation: validateAdvocacyConsolePolicies(policies),
    escalationDeck: createAdvocacyConsoleEscalationDeck(policies),
    analytics: {
      timeline: createAdvocacyConsoleAnalyticsTimeline(),
      forecast: createAdvocacyConsoleForecastEnvelope(),
      exceptions: createAdvocacyConsoleExceptionLedger(),
      summary: summarizeAdvocacyConsoleAnalytics()
    },
    operations: {
      board: createAdvocacyConsoleOperationsBoard(),
      checklist: createAdvocacyConsoleShiftChecklist(),
      incidents: createAdvocacyConsoleIncidentDeck()
    },
    reporting: {
      cards: createAdvocacyConsoleReportCards(),
      packets: createAdvocacyConsoleReviewPackets(),
      summary: summarizeAdvocacyConsoleReporting()
    },
    audit: {
      trail: createAdvocacyConsoleAuditTrail(),
      manifest: createAdvocacyConsoleEvidenceManifest(),
      attestation: createAdvocacyConsoleReadinessAttestation()
    },
    playbooks: createAdvocacyConsolePlaybooks(),
    decisions: createAdvocacyConsoleDecisionDeck(),
    escalationMoments: createAdvocacyConsoleEscalationMoments()
  };
}

export function createAdvocacyConsoleReadinessBoard(snapshot = buildAdvocacyConsoleSnapshot()) {
  return [
    { id: 'advocacy-console-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'advocacy-console-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'advocacy-console-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'advocacy-console-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createAdvocacyConsoleApiDocument(snapshot = buildAdvocacyConsoleSnapshot()) {
  return {
    id: 'advocacy-console-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/advocacy-console/overview' },
      { method: 'GET', path: '/api/advocacy-console/reporting' },
      { method: 'POST', path: '/api/advocacy-console/validate' },
      { method: 'GET', path: '/api/advocacy-console/audit' }
    ],
    readiness: createAdvocacyConsoleReadinessBoard(snapshot)
  };
}

export function createAdvocacyConsoleRouteSummary(snapshot = buildAdvocacyConsoleSnapshot()) {
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

