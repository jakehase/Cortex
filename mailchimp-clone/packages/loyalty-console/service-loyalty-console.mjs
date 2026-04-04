import { createLoyaltyConsoleWorkspace, summarizeLoyaltyConsoleWorkspace, createLoyaltyConsoleNarratives, createLoyaltyConsoleCoverageGrid } from './domain-loyalty-console.mjs';
import { createLoyaltyConsolePolicies, validateLoyaltyConsolePolicies, summarizeLoyaltyConsolePolicies, createLoyaltyConsoleEscalationDeck } from './policies-loyalty-console.mjs';
import { createLoyaltyConsoleAnalyticsTimeline, createLoyaltyConsoleForecastEnvelope, createLoyaltyConsoleExceptionLedger, summarizeLoyaltyConsoleAnalytics } from './analytics-loyalty-console.mjs';
import { createLoyaltyConsoleOperationsBoard, createLoyaltyConsoleShiftChecklist, createLoyaltyConsoleIncidentDeck } from './operations-loyalty-console.mjs';
import { createLoyaltyConsoleReportCards, createLoyaltyConsoleReviewPackets, summarizeLoyaltyConsoleReporting } from './reporting-loyalty-console.mjs';
import { createLoyaltyConsoleAuditTrail, createLoyaltyConsoleEvidenceManifest, createLoyaltyConsoleReadinessAttestation } from './audit-loyalty-console.mjs';
import { createLoyaltyConsolePlaybooks, createLoyaltyConsoleDecisionDeck, createLoyaltyConsoleEscalationMoments } from './playbooks-loyalty-console.mjs';

export function buildLoyaltyConsoleSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createLoyaltyConsoleWorkspace(workspaceName);
  const policies = createLoyaltyConsolePolicies();
  return {
    workspace,
    summary: summarizeLoyaltyConsoleWorkspace(workspace),
    narratives: createLoyaltyConsoleNarratives(workspace),
    coverage: createLoyaltyConsoleCoverageGrid(workspace),
    policies,
    policySummary: summarizeLoyaltyConsolePolicies(policies),
    validation: validateLoyaltyConsolePolicies(policies),
    escalationDeck: createLoyaltyConsoleEscalationDeck(policies),
    analytics: {
      timeline: createLoyaltyConsoleAnalyticsTimeline(),
      forecast: createLoyaltyConsoleForecastEnvelope(),
      exceptions: createLoyaltyConsoleExceptionLedger(),
      summary: summarizeLoyaltyConsoleAnalytics()
    },
    operations: {
      board: createLoyaltyConsoleOperationsBoard(),
      checklist: createLoyaltyConsoleShiftChecklist(),
      incidents: createLoyaltyConsoleIncidentDeck()
    },
    reporting: {
      cards: createLoyaltyConsoleReportCards(),
      packets: createLoyaltyConsoleReviewPackets(),
      summary: summarizeLoyaltyConsoleReporting()
    },
    audit: {
      trail: createLoyaltyConsoleAuditTrail(),
      manifest: createLoyaltyConsoleEvidenceManifest(),
      attestation: createLoyaltyConsoleReadinessAttestation()
    },
    playbooks: createLoyaltyConsolePlaybooks(),
    decisions: createLoyaltyConsoleDecisionDeck(),
    escalationMoments: createLoyaltyConsoleEscalationMoments()
  };
}

export function createLoyaltyConsoleReadinessBoard(snapshot = buildLoyaltyConsoleSnapshot()) {
  return [
    { id: 'loyalty-console-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'loyalty-console-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'loyalty-console-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'loyalty-console-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createLoyaltyConsoleApiDocument(snapshot = buildLoyaltyConsoleSnapshot()) {
  return {
    id: 'loyalty-console-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/loyalty-console/overview' },
      { method: 'GET', path: '/api/loyalty-console/reporting' },
      { method: 'POST', path: '/api/loyalty-console/validate' },
      { method: 'GET', path: '/api/loyalty-console/audit' }
    ],
    readiness: createLoyaltyConsoleReadinessBoard(snapshot)
  };
}

export function createLoyaltyConsoleRouteSummary(snapshot = buildLoyaltyConsoleSnapshot()) {
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

