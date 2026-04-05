import { createAcquisitionConsoleWorkspace, summarizeAcquisitionConsoleWorkspace, createAcquisitionConsoleNarratives, createAcquisitionConsoleCoverageGrid } from './domain-acquisition-console.mjs';
import { createAcquisitionConsolePolicies, validateAcquisitionConsolePolicies, summarizeAcquisitionConsolePolicies, createAcquisitionConsoleEscalationDeck } from './policies-acquisition-console.mjs';
import { createAcquisitionConsoleAnalyticsTimeline, createAcquisitionConsoleForecastEnvelope, createAcquisitionConsoleExceptionLedger, summarizeAcquisitionConsoleAnalytics } from './analytics-acquisition-console.mjs';
import { createAcquisitionConsoleOperationsBoard, createAcquisitionConsoleShiftChecklist, createAcquisitionConsoleIncidentDeck } from './operations-acquisition-console.mjs';
import { createAcquisitionConsoleReportCards, createAcquisitionConsoleReviewPackets, summarizeAcquisitionConsoleReporting } from './reporting-acquisition-console.mjs';
import { createAcquisitionConsoleAuditTrail, createAcquisitionConsoleEvidenceManifest, createAcquisitionConsoleReadinessAttestation } from './audit-acquisition-console.mjs';
import { createAcquisitionConsolePlaybooks, createAcquisitionConsoleDecisionDeck, createAcquisitionConsoleEscalationMoments } from './playbooks-acquisition-console.mjs';

export function buildAcquisitionConsoleSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createAcquisitionConsoleWorkspace(workspaceName);
  const policies = createAcquisitionConsolePolicies();
  return {
    workspace,
    summary: summarizeAcquisitionConsoleWorkspace(workspace),
    narratives: createAcquisitionConsoleNarratives(workspace),
    coverage: createAcquisitionConsoleCoverageGrid(workspace),
    policies,
    policySummary: summarizeAcquisitionConsolePolicies(policies),
    validation: validateAcquisitionConsolePolicies(policies),
    escalationDeck: createAcquisitionConsoleEscalationDeck(policies),
    analytics: {
      timeline: createAcquisitionConsoleAnalyticsTimeline(),
      forecast: createAcquisitionConsoleForecastEnvelope(),
      exceptions: createAcquisitionConsoleExceptionLedger(),
      summary: summarizeAcquisitionConsoleAnalytics()
    },
    operations: {
      board: createAcquisitionConsoleOperationsBoard(),
      checklist: createAcquisitionConsoleShiftChecklist(),
      incidents: createAcquisitionConsoleIncidentDeck()
    },
    reporting: {
      cards: createAcquisitionConsoleReportCards(),
      packets: createAcquisitionConsoleReviewPackets(),
      summary: summarizeAcquisitionConsoleReporting()
    },
    audit: {
      trail: createAcquisitionConsoleAuditTrail(),
      manifest: createAcquisitionConsoleEvidenceManifest(),
      attestation: createAcquisitionConsoleReadinessAttestation()
    },
    playbooks: createAcquisitionConsolePlaybooks(),
    decisions: createAcquisitionConsoleDecisionDeck(),
    escalationMoments: createAcquisitionConsoleEscalationMoments()
  };
}

export function createAcquisitionConsoleReadinessBoard(snapshot = buildAcquisitionConsoleSnapshot()) {
  return [
    { id: 'acquisition-console-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'acquisition-console-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'acquisition-console-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'acquisition-console-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createAcquisitionConsoleApiDocument(snapshot = buildAcquisitionConsoleSnapshot()) {
  return {
    id: 'acquisition-console-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/acquisition-console/overview' },
      { method: 'GET', path: '/api/acquisition-console/reporting' },
      { method: 'POST', path: '/api/acquisition-console/validate' },
      { method: 'GET', path: '/api/acquisition-console/audit' }
    ],
    readiness: createAcquisitionConsoleReadinessBoard(snapshot)
  };
}

export function createAcquisitionConsoleRouteSummary(snapshot = buildAcquisitionConsoleSnapshot()) {
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

