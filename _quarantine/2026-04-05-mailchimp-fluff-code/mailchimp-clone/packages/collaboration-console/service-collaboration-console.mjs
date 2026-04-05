import { createCollaborationConsoleWorkspace, summarizeCollaborationConsoleWorkspace, createCollaborationConsoleNarratives, createCollaborationConsoleCoverageGrid } from './domain-collaboration-console.mjs';
import { createCollaborationConsolePolicies, validateCollaborationConsolePolicies, summarizeCollaborationConsolePolicies, createCollaborationConsoleEscalationDeck } from './policies-collaboration-console.mjs';
import { createCollaborationConsoleAnalyticsTimeline, createCollaborationConsoleForecastEnvelope, createCollaborationConsoleExceptionLedger, summarizeCollaborationConsoleAnalytics } from './analytics-collaboration-console.mjs';
import { createCollaborationConsoleOperationsBoard, createCollaborationConsoleShiftChecklist, createCollaborationConsoleIncidentDeck } from './operations-collaboration-console.mjs';
import { createCollaborationConsoleReportCards, createCollaborationConsoleReviewPackets, summarizeCollaborationConsoleReporting } from './reporting-collaboration-console.mjs';
import { createCollaborationConsoleAuditTrail, createCollaborationConsoleEvidenceManifest, createCollaborationConsoleReadinessAttestation } from './audit-collaboration-console.mjs';
import { createCollaborationConsolePlaybooks, createCollaborationConsoleDecisionDeck, createCollaborationConsoleEscalationMoments } from './playbooks-collaboration-console.mjs';

export function buildCollaborationConsoleSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createCollaborationConsoleWorkspace(workspaceName);
  const policies = createCollaborationConsolePolicies();
  return {
    workspace,
    summary: summarizeCollaborationConsoleWorkspace(workspace),
    narratives: createCollaborationConsoleNarratives(workspace),
    coverage: createCollaborationConsoleCoverageGrid(workspace),
    policies,
    policySummary: summarizeCollaborationConsolePolicies(policies),
    validation: validateCollaborationConsolePolicies(policies),
    escalationDeck: createCollaborationConsoleEscalationDeck(policies),
    analytics: {
      timeline: createCollaborationConsoleAnalyticsTimeline(),
      forecast: createCollaborationConsoleForecastEnvelope(),
      exceptions: createCollaborationConsoleExceptionLedger(),
      summary: summarizeCollaborationConsoleAnalytics()
    },
    operations: {
      board: createCollaborationConsoleOperationsBoard(),
      checklist: createCollaborationConsoleShiftChecklist(),
      incidents: createCollaborationConsoleIncidentDeck()
    },
    reporting: {
      cards: createCollaborationConsoleReportCards(),
      packets: createCollaborationConsoleReviewPackets(),
      summary: summarizeCollaborationConsoleReporting()
    },
    audit: {
      trail: createCollaborationConsoleAuditTrail(),
      manifest: createCollaborationConsoleEvidenceManifest(),
      attestation: createCollaborationConsoleReadinessAttestation()
    },
    playbooks: createCollaborationConsolePlaybooks(),
    decisions: createCollaborationConsoleDecisionDeck(),
    escalationMoments: createCollaborationConsoleEscalationMoments()
  };
}

export function createCollaborationConsoleReadinessBoard(snapshot = buildCollaborationConsoleSnapshot()) {
  return [
    { id: 'collaboration-console-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'collaboration-console-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'collaboration-console-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'collaboration-console-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createCollaborationConsoleApiDocument(snapshot = buildCollaborationConsoleSnapshot()) {
  return {
    id: 'collaboration-console-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/collaboration-console/overview' },
      { method: 'GET', path: '/api/collaboration-console/reporting' },
      { method: 'POST', path: '/api/collaboration-console/validate' },
      { method: 'GET', path: '/api/collaboration-console/audit' }
    ],
    readiness: createCollaborationConsoleReadinessBoard(snapshot)
  };
}

export function createCollaborationConsoleRouteSummary(snapshot = buildCollaborationConsoleSnapshot()) {
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

