import { createConsentConsoleWorkspace, summarizeConsentConsoleWorkspace, createConsentConsoleNarratives, createConsentConsoleCoverageGrid } from './domain-consent-console.mjs';
import { createConsentConsolePolicies, validateConsentConsolePolicies, summarizeConsentConsolePolicies, createConsentConsoleEscalationDeck } from './policies-consent-console.mjs';
import { createConsentConsoleAnalyticsTimeline, createConsentConsoleForecastEnvelope, createConsentConsoleExceptionLedger, summarizeConsentConsoleAnalytics } from './analytics-consent-console.mjs';
import { createConsentConsoleOperationsBoard, createConsentConsoleShiftChecklist, createConsentConsoleIncidentDeck } from './operations-consent-console.mjs';
import { createConsentConsoleReportCards, createConsentConsoleReviewPackets, summarizeConsentConsoleReporting } from './reporting-consent-console.mjs';
import { createConsentConsoleAuditTrail, createConsentConsoleEvidenceManifest, createConsentConsoleReadinessAttestation } from './audit-consent-console.mjs';
import { createConsentConsolePlaybooks, createConsentConsoleDecisionDeck, createConsentConsoleEscalationMoments } from './playbooks-consent-console.mjs';

export function buildConsentConsoleSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createConsentConsoleWorkspace(workspaceName);
  const policies = createConsentConsolePolicies();
  return {
    workspace,
    summary: summarizeConsentConsoleWorkspace(workspace),
    narratives: createConsentConsoleNarratives(workspace),
    coverage: createConsentConsoleCoverageGrid(workspace),
    policies,
    policySummary: summarizeConsentConsolePolicies(policies),
    validation: validateConsentConsolePolicies(policies),
    escalationDeck: createConsentConsoleEscalationDeck(policies),
    analytics: {
      timeline: createConsentConsoleAnalyticsTimeline(),
      forecast: createConsentConsoleForecastEnvelope(),
      exceptions: createConsentConsoleExceptionLedger(),
      summary: summarizeConsentConsoleAnalytics()
    },
    operations: {
      board: createConsentConsoleOperationsBoard(),
      checklist: createConsentConsoleShiftChecklist(),
      incidents: createConsentConsoleIncidentDeck()
    },
    reporting: {
      cards: createConsentConsoleReportCards(),
      packets: createConsentConsoleReviewPackets(),
      summary: summarizeConsentConsoleReporting()
    },
    audit: {
      trail: createConsentConsoleAuditTrail(),
      manifest: createConsentConsoleEvidenceManifest(),
      attestation: createConsentConsoleReadinessAttestation()
    },
    playbooks: createConsentConsolePlaybooks(),
    decisions: createConsentConsoleDecisionDeck(),
    escalationMoments: createConsentConsoleEscalationMoments()
  };
}

export function createConsentConsoleReadinessBoard(snapshot = buildConsentConsoleSnapshot()) {
  return [
    { id: 'consent-console-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'consent-console-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'consent-console-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'consent-console-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createConsentConsoleApiDocument(snapshot = buildConsentConsoleSnapshot()) {
  return {
    id: 'consent-console-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/consent-console/overview' },
      { method: 'GET', path: '/api/consent-console/reporting' },
      { method: 'POST', path: '/api/consent-console/validate' },
      { method: 'GET', path: '/api/consent-console/audit' }
    ],
    readiness: createConsentConsoleReadinessBoard(snapshot)
  };
}

export function createConsentConsoleRouteSummary(snapshot = buildConsentConsoleSnapshot()) {
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

