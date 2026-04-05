import { createActivationConsoleWorkspace, summarizeActivationConsoleWorkspace, createActivationConsoleNarratives, createActivationConsoleCoverageGrid } from './domain-activation-console.mjs';
import { createActivationConsolePolicies, validateActivationConsolePolicies, summarizeActivationConsolePolicies, createActivationConsoleEscalationDeck } from './policies-activation-console.mjs';
import { createActivationConsoleAnalyticsTimeline, createActivationConsoleForecastEnvelope, createActivationConsoleExceptionLedger, summarizeActivationConsoleAnalytics } from './analytics-activation-console.mjs';
import { createActivationConsoleOperationsBoard, createActivationConsoleShiftChecklist, createActivationConsoleIncidentDeck } from './operations-activation-console.mjs';
import { createActivationConsoleReportCards, createActivationConsoleReviewPackets, summarizeActivationConsoleReporting } from './reporting-activation-console.mjs';
import { createActivationConsoleAuditTrail, createActivationConsoleEvidenceManifest, createActivationConsoleReadinessAttestation } from './audit-activation-console.mjs';
import { createActivationConsolePlaybooks, createActivationConsoleDecisionDeck, createActivationConsoleEscalationMoments } from './playbooks-activation-console.mjs';

export function buildActivationConsoleSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createActivationConsoleWorkspace(workspaceName);
  const policies = createActivationConsolePolicies();
  return {
    workspace,
    summary: summarizeActivationConsoleWorkspace(workspace),
    narratives: createActivationConsoleNarratives(workspace),
    coverage: createActivationConsoleCoverageGrid(workspace),
    policies,
    policySummary: summarizeActivationConsolePolicies(policies),
    validation: validateActivationConsolePolicies(policies),
    escalationDeck: createActivationConsoleEscalationDeck(policies),
    analytics: {
      timeline: createActivationConsoleAnalyticsTimeline(),
      forecast: createActivationConsoleForecastEnvelope(),
      exceptions: createActivationConsoleExceptionLedger(),
      summary: summarizeActivationConsoleAnalytics()
    },
    operations: {
      board: createActivationConsoleOperationsBoard(),
      checklist: createActivationConsoleShiftChecklist(),
      incidents: createActivationConsoleIncidentDeck()
    },
    reporting: {
      cards: createActivationConsoleReportCards(),
      packets: createActivationConsoleReviewPackets(),
      summary: summarizeActivationConsoleReporting()
    },
    audit: {
      trail: createActivationConsoleAuditTrail(),
      manifest: createActivationConsoleEvidenceManifest(),
      attestation: createActivationConsoleReadinessAttestation()
    },
    playbooks: createActivationConsolePlaybooks(),
    decisions: createActivationConsoleDecisionDeck(),
    escalationMoments: createActivationConsoleEscalationMoments()
  };
}

export function createActivationConsoleReadinessBoard(snapshot = buildActivationConsoleSnapshot()) {
  return [
    { id: 'activation-console-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'activation-console-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'activation-console-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'activation-console-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createActivationConsoleApiDocument(snapshot = buildActivationConsoleSnapshot()) {
  return {
    id: 'activation-console-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/activation-console/overview' },
      { method: 'GET', path: '/api/activation-console/reporting' },
      { method: 'POST', path: '/api/activation-console/validate' },
      { method: 'GET', path: '/api/activation-console/audit' }
    ],
    readiness: createActivationConsoleReadinessBoard(snapshot)
  };
}

export function createActivationConsoleRouteSummary(snapshot = buildActivationConsoleSnapshot()) {
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

