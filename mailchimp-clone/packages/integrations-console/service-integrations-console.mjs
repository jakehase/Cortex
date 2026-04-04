import { createIntegrationsConsoleWorkspace, summarizeIntegrationsConsoleWorkspace, createIntegrationsConsoleNarratives, createIntegrationsConsoleCoverageGrid } from './domain-integrations-console.mjs';
import { createIntegrationsConsolePolicies, validateIntegrationsConsolePolicies, summarizeIntegrationsConsolePolicies, createIntegrationsConsoleEscalationDeck } from './policies-integrations-console.mjs';
import { createIntegrationsConsoleAnalyticsTimeline, createIntegrationsConsoleForecastEnvelope, createIntegrationsConsoleExceptionLedger, summarizeIntegrationsConsoleAnalytics } from './analytics-integrations-console.mjs';
import { createIntegrationsConsoleOperationsBoard, createIntegrationsConsoleShiftChecklist, createIntegrationsConsoleIncidentDeck } from './operations-integrations-console.mjs';
import { createIntegrationsConsoleReportCards, createIntegrationsConsoleReviewPackets, summarizeIntegrationsConsoleReporting } from './reporting-integrations-console.mjs';
import { createIntegrationsConsoleAuditTrail, createIntegrationsConsoleEvidenceManifest, createIntegrationsConsoleReadinessAttestation } from './audit-integrations-console.mjs';
import { createIntegrationsConsolePlaybooks, createIntegrationsConsoleDecisionDeck, createIntegrationsConsoleEscalationMoments } from './playbooks-integrations-console.mjs';

export function buildIntegrationsConsoleSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createIntegrationsConsoleWorkspace(workspaceName);
  const policies = createIntegrationsConsolePolicies();
  return {
    workspace,
    summary: summarizeIntegrationsConsoleWorkspace(workspace),
    narratives: createIntegrationsConsoleNarratives(workspace),
    coverage: createIntegrationsConsoleCoverageGrid(workspace),
    policies,
    policySummary: summarizeIntegrationsConsolePolicies(policies),
    validation: validateIntegrationsConsolePolicies(policies),
    escalationDeck: createIntegrationsConsoleEscalationDeck(policies),
    analytics: {
      timeline: createIntegrationsConsoleAnalyticsTimeline(),
      forecast: createIntegrationsConsoleForecastEnvelope(),
      exceptions: createIntegrationsConsoleExceptionLedger(),
      summary: summarizeIntegrationsConsoleAnalytics()
    },
    operations: {
      board: createIntegrationsConsoleOperationsBoard(),
      checklist: createIntegrationsConsoleShiftChecklist(),
      incidents: createIntegrationsConsoleIncidentDeck()
    },
    reporting: {
      cards: createIntegrationsConsoleReportCards(),
      packets: createIntegrationsConsoleReviewPackets(),
      summary: summarizeIntegrationsConsoleReporting()
    },
    audit: {
      trail: createIntegrationsConsoleAuditTrail(),
      manifest: createIntegrationsConsoleEvidenceManifest(),
      attestation: createIntegrationsConsoleReadinessAttestation()
    },
    playbooks: createIntegrationsConsolePlaybooks(),
    decisions: createIntegrationsConsoleDecisionDeck(),
    escalationMoments: createIntegrationsConsoleEscalationMoments()
  };
}

export function createIntegrationsConsoleReadinessBoard(snapshot = buildIntegrationsConsoleSnapshot()) {
  return [
    { id: 'integrations-console-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'integrations-console-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'integrations-console-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'integrations-console-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createIntegrationsConsoleApiDocument(snapshot = buildIntegrationsConsoleSnapshot()) {
  return {
    id: 'integrations-console-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/integrations-console/overview' },
      { method: 'GET', path: '/api/integrations-console/reporting' },
      { method: 'POST', path: '/api/integrations-console/validate' },
      { method: 'GET', path: '/api/integrations-console/audit' }
    ],
    readiness: createIntegrationsConsoleReadinessBoard(snapshot)
  };
}

export function createIntegrationsConsoleRouteSummary(snapshot = buildIntegrationsConsoleSnapshot()) {
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

