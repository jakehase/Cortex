import { createBenchmarkConsoleWorkspace, summarizeBenchmarkConsoleWorkspace, createBenchmarkConsoleNarratives, createBenchmarkConsoleCoverageGrid } from './domain-benchmark-console.mjs';
import { createBenchmarkConsolePolicies, validateBenchmarkConsolePolicies, summarizeBenchmarkConsolePolicies, createBenchmarkConsoleEscalationDeck } from './policies-benchmark-console.mjs';
import { createBenchmarkConsoleAnalyticsTimeline, createBenchmarkConsoleForecastEnvelope, createBenchmarkConsoleExceptionLedger, summarizeBenchmarkConsoleAnalytics } from './analytics-benchmark-console.mjs';
import { createBenchmarkConsoleOperationsBoard, createBenchmarkConsoleShiftChecklist, createBenchmarkConsoleIncidentDeck } from './operations-benchmark-console.mjs';
import { createBenchmarkConsoleReportCards, createBenchmarkConsoleReviewPackets, summarizeBenchmarkConsoleReporting } from './reporting-benchmark-console.mjs';
import { createBenchmarkConsoleAuditTrail, createBenchmarkConsoleEvidenceManifest, createBenchmarkConsoleReadinessAttestation } from './audit-benchmark-console.mjs';
import { createBenchmarkConsolePlaybooks, createBenchmarkConsoleDecisionDeck, createBenchmarkConsoleEscalationMoments } from './playbooks-benchmark-console.mjs';

export function buildBenchmarkConsoleSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createBenchmarkConsoleWorkspace(workspaceName);
  const policies = createBenchmarkConsolePolicies();
  return {
    workspace,
    summary: summarizeBenchmarkConsoleWorkspace(workspace),
    narratives: createBenchmarkConsoleNarratives(workspace),
    coverage: createBenchmarkConsoleCoverageGrid(workspace),
    policies,
    policySummary: summarizeBenchmarkConsolePolicies(policies),
    validation: validateBenchmarkConsolePolicies(policies),
    escalationDeck: createBenchmarkConsoleEscalationDeck(policies),
    analytics: {
      timeline: createBenchmarkConsoleAnalyticsTimeline(),
      forecast: createBenchmarkConsoleForecastEnvelope(),
      exceptions: createBenchmarkConsoleExceptionLedger(),
      summary: summarizeBenchmarkConsoleAnalytics()
    },
    operations: {
      board: createBenchmarkConsoleOperationsBoard(),
      checklist: createBenchmarkConsoleShiftChecklist(),
      incidents: createBenchmarkConsoleIncidentDeck()
    },
    reporting: {
      cards: createBenchmarkConsoleReportCards(),
      packets: createBenchmarkConsoleReviewPackets(),
      summary: summarizeBenchmarkConsoleReporting()
    },
    audit: {
      trail: createBenchmarkConsoleAuditTrail(),
      manifest: createBenchmarkConsoleEvidenceManifest(),
      attestation: createBenchmarkConsoleReadinessAttestation()
    },
    playbooks: createBenchmarkConsolePlaybooks(),
    decisions: createBenchmarkConsoleDecisionDeck(),
    escalationMoments: createBenchmarkConsoleEscalationMoments()
  };
}

export function createBenchmarkConsoleReadinessBoard(snapshot = buildBenchmarkConsoleSnapshot()) {
  return [
    { id: 'benchmark-console-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'benchmark-console-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'benchmark-console-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'benchmark-console-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createBenchmarkConsoleApiDocument(snapshot = buildBenchmarkConsoleSnapshot()) {
  return {
    id: 'benchmark-console-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/benchmark-console/overview' },
      { method: 'GET', path: '/api/benchmark-console/reporting' },
      { method: 'POST', path: '/api/benchmark-console/validate' },
      { method: 'GET', path: '/api/benchmark-console/audit' }
    ],
    readiness: createBenchmarkConsoleReadinessBoard(snapshot)
  };
}

export function createBenchmarkConsoleRouteSummary(snapshot = buildBenchmarkConsoleSnapshot()) {
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

