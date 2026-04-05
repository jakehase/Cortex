import { createDeliverabilityConsoleWorkspace, summarizeDeliverabilityConsoleWorkspace, createDeliverabilityConsoleNarratives, createDeliverabilityConsoleCoverageGrid } from './domain-deliverability-console.mjs';
import { createDeliverabilityConsolePolicies, validateDeliverabilityConsolePolicies, summarizeDeliverabilityConsolePolicies, createDeliverabilityConsoleEscalationDeck } from './policies-deliverability-console.mjs';
import { createDeliverabilityConsoleAnalyticsTimeline, createDeliverabilityConsoleForecastEnvelope, createDeliverabilityConsoleExceptionLedger, summarizeDeliverabilityConsoleAnalytics } from './analytics-deliverability-console.mjs';
import { createDeliverabilityConsoleOperationsBoard, createDeliverabilityConsoleShiftChecklist, createDeliverabilityConsoleIncidentDeck } from './operations-deliverability-console.mjs';
import { createDeliverabilityConsoleReportCards, createDeliverabilityConsoleReviewPackets, summarizeDeliverabilityConsoleReporting } from './reporting-deliverability-console.mjs';
import { createDeliverabilityConsoleAuditTrail, createDeliverabilityConsoleEvidenceManifest, createDeliverabilityConsoleReadinessAttestation } from './audit-deliverability-console.mjs';
import { createDeliverabilityConsolePlaybooks, createDeliverabilityConsoleDecisionDeck, createDeliverabilityConsoleEscalationMoments } from './playbooks-deliverability-console.mjs';

export function buildDeliverabilityConsoleSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createDeliverabilityConsoleWorkspace(workspaceName);
  const policies = createDeliverabilityConsolePolicies();
  return {
    workspace,
    summary: summarizeDeliverabilityConsoleWorkspace(workspace),
    narratives: createDeliverabilityConsoleNarratives(workspace),
    coverage: createDeliverabilityConsoleCoverageGrid(workspace),
    policies,
    policySummary: summarizeDeliverabilityConsolePolicies(policies),
    validation: validateDeliverabilityConsolePolicies(policies),
    escalationDeck: createDeliverabilityConsoleEscalationDeck(policies),
    analytics: {
      timeline: createDeliverabilityConsoleAnalyticsTimeline(),
      forecast: createDeliverabilityConsoleForecastEnvelope(),
      exceptions: createDeliverabilityConsoleExceptionLedger(),
      summary: summarizeDeliverabilityConsoleAnalytics()
    },
    operations: {
      board: createDeliverabilityConsoleOperationsBoard(),
      checklist: createDeliverabilityConsoleShiftChecklist(),
      incidents: createDeliverabilityConsoleIncidentDeck()
    },
    reporting: {
      cards: createDeliverabilityConsoleReportCards(),
      packets: createDeliverabilityConsoleReviewPackets(),
      summary: summarizeDeliverabilityConsoleReporting()
    },
    audit: {
      trail: createDeliverabilityConsoleAuditTrail(),
      manifest: createDeliverabilityConsoleEvidenceManifest(),
      attestation: createDeliverabilityConsoleReadinessAttestation()
    },
    playbooks: createDeliverabilityConsolePlaybooks(),
    decisions: createDeliverabilityConsoleDecisionDeck(),
    escalationMoments: createDeliverabilityConsoleEscalationMoments()
  };
}

export function createDeliverabilityConsoleReadinessBoard(snapshot = buildDeliverabilityConsoleSnapshot()) {
  return [
    { id: 'deliverability-console-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'deliverability-console-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'deliverability-console-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'deliverability-console-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createDeliverabilityConsoleApiDocument(snapshot = buildDeliverabilityConsoleSnapshot()) {
  return {
    id: 'deliverability-console-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/deliverability-console/overview' },
      { method: 'GET', path: '/api/deliverability-console/reporting' },
      { method: 'POST', path: '/api/deliverability-console/validate' },
      { method: 'GET', path: '/api/deliverability-console/audit' }
    ],
    readiness: createDeliverabilityConsoleReadinessBoard(snapshot)
  };
}

export function createDeliverabilityConsoleRouteSummary(snapshot = buildDeliverabilityConsoleSnapshot()) {
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

