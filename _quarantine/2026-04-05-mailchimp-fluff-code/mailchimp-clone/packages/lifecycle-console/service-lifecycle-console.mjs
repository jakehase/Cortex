import { createLifecycleConsoleWorkspace, summarizeLifecycleConsoleWorkspace, createLifecycleConsoleNarratives, createLifecycleConsoleCoverageGrid } from './domain-lifecycle-console.mjs';
import { createLifecycleConsolePolicies, validateLifecycleConsolePolicies, summarizeLifecycleConsolePolicies, createLifecycleConsoleEscalationDeck } from './policies-lifecycle-console.mjs';
import { createLifecycleConsoleAnalyticsTimeline, createLifecycleConsoleForecastEnvelope, createLifecycleConsoleExceptionLedger, summarizeLifecycleConsoleAnalytics } from './analytics-lifecycle-console.mjs';
import { createLifecycleConsoleOperationsBoard, createLifecycleConsoleShiftChecklist, createLifecycleConsoleIncidentDeck } from './operations-lifecycle-console.mjs';
import { createLifecycleConsoleReportCards, createLifecycleConsoleReviewPackets, summarizeLifecycleConsoleReporting } from './reporting-lifecycle-console.mjs';
import { createLifecycleConsoleAuditTrail, createLifecycleConsoleEvidenceManifest, createLifecycleConsoleReadinessAttestation } from './audit-lifecycle-console.mjs';
import { createLifecycleConsolePlaybooks, createLifecycleConsoleDecisionDeck, createLifecycleConsoleEscalationMoments } from './playbooks-lifecycle-console.mjs';

export function buildLifecycleConsoleSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createLifecycleConsoleWorkspace(workspaceName);
  const policies = createLifecycleConsolePolicies();
  return {
    workspace,
    summary: summarizeLifecycleConsoleWorkspace(workspace),
    narratives: createLifecycleConsoleNarratives(workspace),
    coverage: createLifecycleConsoleCoverageGrid(workspace),
    policies,
    policySummary: summarizeLifecycleConsolePolicies(policies),
    validation: validateLifecycleConsolePolicies(policies),
    escalationDeck: createLifecycleConsoleEscalationDeck(policies),
    analytics: {
      timeline: createLifecycleConsoleAnalyticsTimeline(),
      forecast: createLifecycleConsoleForecastEnvelope(),
      exceptions: createLifecycleConsoleExceptionLedger(),
      summary: summarizeLifecycleConsoleAnalytics()
    },
    operations: {
      board: createLifecycleConsoleOperationsBoard(),
      checklist: createLifecycleConsoleShiftChecklist(),
      incidents: createLifecycleConsoleIncidentDeck()
    },
    reporting: {
      cards: createLifecycleConsoleReportCards(),
      packets: createLifecycleConsoleReviewPackets(),
      summary: summarizeLifecycleConsoleReporting()
    },
    audit: {
      trail: createLifecycleConsoleAuditTrail(),
      manifest: createLifecycleConsoleEvidenceManifest(),
      attestation: createLifecycleConsoleReadinessAttestation()
    },
    playbooks: createLifecycleConsolePlaybooks(),
    decisions: createLifecycleConsoleDecisionDeck(),
    escalationMoments: createLifecycleConsoleEscalationMoments()
  };
}

export function createLifecycleConsoleReadinessBoard(snapshot = buildLifecycleConsoleSnapshot()) {
  return [
    { id: 'lifecycle-console-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'lifecycle-console-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'lifecycle-console-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'lifecycle-console-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createLifecycleConsoleApiDocument(snapshot = buildLifecycleConsoleSnapshot()) {
  return {
    id: 'lifecycle-console-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/lifecycle-console/overview' },
      { method: 'GET', path: '/api/lifecycle-console/reporting' },
      { method: 'POST', path: '/api/lifecycle-console/validate' },
      { method: 'GET', path: '/api/lifecycle-console/audit' }
    ],
    readiness: createLifecycleConsoleReadinessBoard(snapshot)
  };
}

export function createLifecycleConsoleRouteSummary(snapshot = buildLifecycleConsoleSnapshot()) {
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

