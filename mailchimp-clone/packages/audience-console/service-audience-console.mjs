import { createAudienceConsoleWorkspace, summarizeAudienceConsoleWorkspace, createAudienceConsoleNarratives, createAudienceConsoleCoverageGrid } from './domain-audience-console.mjs';
import { createAudienceConsolePolicies, validateAudienceConsolePolicies, summarizeAudienceConsolePolicies, createAudienceConsoleEscalationDeck } from './policies-audience-console.mjs';
import { createAudienceConsoleAnalyticsTimeline, createAudienceConsoleForecastEnvelope, createAudienceConsoleExceptionLedger, summarizeAudienceConsoleAnalytics } from './analytics-audience-console.mjs';
import { createAudienceConsoleOperationsBoard, createAudienceConsoleShiftChecklist, createAudienceConsoleIncidentDeck } from './operations-audience-console.mjs';
import { createAudienceConsoleReportCards, createAudienceConsoleReviewPackets, summarizeAudienceConsoleReporting } from './reporting-audience-console.mjs';
import { createAudienceConsoleAuditTrail, createAudienceConsoleEvidenceManifest, createAudienceConsoleReadinessAttestation } from './audit-audience-console.mjs';
import { createAudienceConsolePlaybooks, createAudienceConsoleDecisionDeck, createAudienceConsoleEscalationMoments } from './playbooks-audience-console.mjs';

export function buildAudienceConsoleSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createAudienceConsoleWorkspace(workspaceName);
  const policies = createAudienceConsolePolicies();
  return {
    workspace,
    summary: summarizeAudienceConsoleWorkspace(workspace),
    narratives: createAudienceConsoleNarratives(workspace),
    coverage: createAudienceConsoleCoverageGrid(workspace),
    policies,
    policySummary: summarizeAudienceConsolePolicies(policies),
    validation: validateAudienceConsolePolicies(policies),
    escalationDeck: createAudienceConsoleEscalationDeck(policies),
    analytics: {
      timeline: createAudienceConsoleAnalyticsTimeline(),
      forecast: createAudienceConsoleForecastEnvelope(),
      exceptions: createAudienceConsoleExceptionLedger(),
      summary: summarizeAudienceConsoleAnalytics()
    },
    operations: {
      board: createAudienceConsoleOperationsBoard(),
      checklist: createAudienceConsoleShiftChecklist(),
      incidents: createAudienceConsoleIncidentDeck()
    },
    reporting: {
      cards: createAudienceConsoleReportCards(),
      packets: createAudienceConsoleReviewPackets(),
      summary: summarizeAudienceConsoleReporting()
    },
    audit: {
      trail: createAudienceConsoleAuditTrail(),
      manifest: createAudienceConsoleEvidenceManifest(),
      attestation: createAudienceConsoleReadinessAttestation()
    },
    playbooks: createAudienceConsolePlaybooks(),
    decisions: createAudienceConsoleDecisionDeck(),
    escalationMoments: createAudienceConsoleEscalationMoments()
  };
}

export function createAudienceConsoleReadinessBoard(snapshot = buildAudienceConsoleSnapshot()) {
  return [
    { id: 'audience-console-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'audience-console-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'audience-console-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'audience-console-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createAudienceConsoleApiDocument(snapshot = buildAudienceConsoleSnapshot()) {
  return {
    id: 'audience-console-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/audience-console/overview' },
      { method: 'GET', path: '/api/audience-console/reporting' },
      { method: 'POST', path: '/api/audience-console/validate' },
      { method: 'GET', path: '/api/audience-console/audit' }
    ],
    readiness: createAudienceConsoleReadinessBoard(snapshot)
  };
}

export function createAudienceConsoleRouteSummary(snapshot = buildAudienceConsoleSnapshot()) {
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

