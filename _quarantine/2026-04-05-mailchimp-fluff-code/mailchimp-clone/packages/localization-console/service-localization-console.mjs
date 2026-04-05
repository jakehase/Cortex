import { createLocalizationConsoleWorkspace, summarizeLocalizationConsoleWorkspace, createLocalizationConsoleNarratives, createLocalizationConsoleCoverageGrid } from './domain-localization-console.mjs';
import { createLocalizationConsolePolicies, validateLocalizationConsolePolicies, summarizeLocalizationConsolePolicies, createLocalizationConsoleEscalationDeck } from './policies-localization-console.mjs';
import { createLocalizationConsoleAnalyticsTimeline, createLocalizationConsoleForecastEnvelope, createLocalizationConsoleExceptionLedger, summarizeLocalizationConsoleAnalytics } from './analytics-localization-console.mjs';
import { createLocalizationConsoleOperationsBoard, createLocalizationConsoleShiftChecklist, createLocalizationConsoleIncidentDeck } from './operations-localization-console.mjs';
import { createLocalizationConsoleReportCards, createLocalizationConsoleReviewPackets, summarizeLocalizationConsoleReporting } from './reporting-localization-console.mjs';
import { createLocalizationConsoleAuditTrail, createLocalizationConsoleEvidenceManifest, createLocalizationConsoleReadinessAttestation } from './audit-localization-console.mjs';
import { createLocalizationConsolePlaybooks, createLocalizationConsoleDecisionDeck, createLocalizationConsoleEscalationMoments } from './playbooks-localization-console.mjs';

export function buildLocalizationConsoleSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createLocalizationConsoleWorkspace(workspaceName);
  const policies = createLocalizationConsolePolicies();
  return {
    workspace,
    summary: summarizeLocalizationConsoleWorkspace(workspace),
    narratives: createLocalizationConsoleNarratives(workspace),
    coverage: createLocalizationConsoleCoverageGrid(workspace),
    policies,
    policySummary: summarizeLocalizationConsolePolicies(policies),
    validation: validateLocalizationConsolePolicies(policies),
    escalationDeck: createLocalizationConsoleEscalationDeck(policies),
    analytics: {
      timeline: createLocalizationConsoleAnalyticsTimeline(),
      forecast: createLocalizationConsoleForecastEnvelope(),
      exceptions: createLocalizationConsoleExceptionLedger(),
      summary: summarizeLocalizationConsoleAnalytics()
    },
    operations: {
      board: createLocalizationConsoleOperationsBoard(),
      checklist: createLocalizationConsoleShiftChecklist(),
      incidents: createLocalizationConsoleIncidentDeck()
    },
    reporting: {
      cards: createLocalizationConsoleReportCards(),
      packets: createLocalizationConsoleReviewPackets(),
      summary: summarizeLocalizationConsoleReporting()
    },
    audit: {
      trail: createLocalizationConsoleAuditTrail(),
      manifest: createLocalizationConsoleEvidenceManifest(),
      attestation: createLocalizationConsoleReadinessAttestation()
    },
    playbooks: createLocalizationConsolePlaybooks(),
    decisions: createLocalizationConsoleDecisionDeck(),
    escalationMoments: createLocalizationConsoleEscalationMoments()
  };
}

export function createLocalizationConsoleReadinessBoard(snapshot = buildLocalizationConsoleSnapshot()) {
  return [
    { id: 'localization-console-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'localization-console-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'localization-console-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'localization-console-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createLocalizationConsoleApiDocument(snapshot = buildLocalizationConsoleSnapshot()) {
  return {
    id: 'localization-console-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/localization-console/overview' },
      { method: 'GET', path: '/api/localization-console/reporting' },
      { method: 'POST', path: '/api/localization-console/validate' },
      { method: 'GET', path: '/api/localization-console/audit' }
    ],
    readiness: createLocalizationConsoleReadinessBoard(snapshot)
  };
}

export function createLocalizationConsoleRouteSummary(snapshot = buildLocalizationConsoleSnapshot()) {
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

