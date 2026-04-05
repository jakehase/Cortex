import { createCreativeConsoleWorkspace, summarizeCreativeConsoleWorkspace, createCreativeConsoleNarratives, createCreativeConsoleCoverageGrid } from './domain-creative-console.mjs';
import { createCreativeConsolePolicies, validateCreativeConsolePolicies, summarizeCreativeConsolePolicies, createCreativeConsoleEscalationDeck } from './policies-creative-console.mjs';
import { createCreativeConsoleAnalyticsTimeline, createCreativeConsoleForecastEnvelope, createCreativeConsoleExceptionLedger, summarizeCreativeConsoleAnalytics } from './analytics-creative-console.mjs';
import { createCreativeConsoleOperationsBoard, createCreativeConsoleShiftChecklist, createCreativeConsoleIncidentDeck } from './operations-creative-console.mjs';
import { createCreativeConsoleReportCards, createCreativeConsoleReviewPackets, summarizeCreativeConsoleReporting } from './reporting-creative-console.mjs';
import { createCreativeConsoleAuditTrail, createCreativeConsoleEvidenceManifest, createCreativeConsoleReadinessAttestation } from './audit-creative-console.mjs';
import { createCreativeConsolePlaybooks, createCreativeConsoleDecisionDeck, createCreativeConsoleEscalationMoments } from './playbooks-creative-console.mjs';

export function buildCreativeConsoleSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createCreativeConsoleWorkspace(workspaceName);
  const policies = createCreativeConsolePolicies();
  return {
    workspace,
    summary: summarizeCreativeConsoleWorkspace(workspace),
    narratives: createCreativeConsoleNarratives(workspace),
    coverage: createCreativeConsoleCoverageGrid(workspace),
    policies,
    policySummary: summarizeCreativeConsolePolicies(policies),
    validation: validateCreativeConsolePolicies(policies),
    escalationDeck: createCreativeConsoleEscalationDeck(policies),
    analytics: {
      timeline: createCreativeConsoleAnalyticsTimeline(),
      forecast: createCreativeConsoleForecastEnvelope(),
      exceptions: createCreativeConsoleExceptionLedger(),
      summary: summarizeCreativeConsoleAnalytics()
    },
    operations: {
      board: createCreativeConsoleOperationsBoard(),
      checklist: createCreativeConsoleShiftChecklist(),
      incidents: createCreativeConsoleIncidentDeck()
    },
    reporting: {
      cards: createCreativeConsoleReportCards(),
      packets: createCreativeConsoleReviewPackets(),
      summary: summarizeCreativeConsoleReporting()
    },
    audit: {
      trail: createCreativeConsoleAuditTrail(),
      manifest: createCreativeConsoleEvidenceManifest(),
      attestation: createCreativeConsoleReadinessAttestation()
    },
    playbooks: createCreativeConsolePlaybooks(),
    decisions: createCreativeConsoleDecisionDeck(),
    escalationMoments: createCreativeConsoleEscalationMoments()
  };
}

export function createCreativeConsoleReadinessBoard(snapshot = buildCreativeConsoleSnapshot()) {
  return [
    { id: 'creative-console-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'creative-console-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'creative-console-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'creative-console-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createCreativeConsoleApiDocument(snapshot = buildCreativeConsoleSnapshot()) {
  return {
    id: 'creative-console-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/creative-console/overview' },
      { method: 'GET', path: '/api/creative-console/reporting' },
      { method: 'POST', path: '/api/creative-console/validate' },
      { method: 'GET', path: '/api/creative-console/audit' }
    ],
    readiness: createCreativeConsoleReadinessBoard(snapshot)
  };
}

export function createCreativeConsoleRouteSummary(snapshot = buildCreativeConsoleSnapshot()) {
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

