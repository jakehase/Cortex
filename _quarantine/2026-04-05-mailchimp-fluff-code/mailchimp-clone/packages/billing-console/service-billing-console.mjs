import { createBillingConsoleWorkspace, summarizeBillingConsoleWorkspace, createBillingConsoleNarratives, createBillingConsoleCoverageGrid } from './domain-billing-console.mjs';
import { createBillingConsolePolicies, validateBillingConsolePolicies, summarizeBillingConsolePolicies, createBillingConsoleEscalationDeck } from './policies-billing-console.mjs';
import { createBillingConsoleAnalyticsTimeline, createBillingConsoleForecastEnvelope, createBillingConsoleExceptionLedger, summarizeBillingConsoleAnalytics } from './analytics-billing-console.mjs';
import { createBillingConsoleOperationsBoard, createBillingConsoleShiftChecklist, createBillingConsoleIncidentDeck } from './operations-billing-console.mjs';
import { createBillingConsoleReportCards, createBillingConsoleReviewPackets, summarizeBillingConsoleReporting } from './reporting-billing-console.mjs';
import { createBillingConsoleAuditTrail, createBillingConsoleEvidenceManifest, createBillingConsoleReadinessAttestation } from './audit-billing-console.mjs';
import { createBillingConsolePlaybooks, createBillingConsoleDecisionDeck, createBillingConsoleEscalationMoments } from './playbooks-billing-console.mjs';

export function buildBillingConsoleSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createBillingConsoleWorkspace(workspaceName);
  const policies = createBillingConsolePolicies();
  return {
    workspace,
    summary: summarizeBillingConsoleWorkspace(workspace),
    narratives: createBillingConsoleNarratives(workspace),
    coverage: createBillingConsoleCoverageGrid(workspace),
    policies,
    policySummary: summarizeBillingConsolePolicies(policies),
    validation: validateBillingConsolePolicies(policies),
    escalationDeck: createBillingConsoleEscalationDeck(policies),
    analytics: {
      timeline: createBillingConsoleAnalyticsTimeline(),
      forecast: createBillingConsoleForecastEnvelope(),
      exceptions: createBillingConsoleExceptionLedger(),
      summary: summarizeBillingConsoleAnalytics()
    },
    operations: {
      board: createBillingConsoleOperationsBoard(),
      checklist: createBillingConsoleShiftChecklist(),
      incidents: createBillingConsoleIncidentDeck()
    },
    reporting: {
      cards: createBillingConsoleReportCards(),
      packets: createBillingConsoleReviewPackets(),
      summary: summarizeBillingConsoleReporting()
    },
    audit: {
      trail: createBillingConsoleAuditTrail(),
      manifest: createBillingConsoleEvidenceManifest(),
      attestation: createBillingConsoleReadinessAttestation()
    },
    playbooks: createBillingConsolePlaybooks(),
    decisions: createBillingConsoleDecisionDeck(),
    escalationMoments: createBillingConsoleEscalationMoments()
  };
}

export function createBillingConsoleReadinessBoard(snapshot = buildBillingConsoleSnapshot()) {
  return [
    { id: 'billing-console-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'billing-console-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'billing-console-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'billing-console-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createBillingConsoleApiDocument(snapshot = buildBillingConsoleSnapshot()) {
  return {
    id: 'billing-console-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/billing-console/overview' },
      { method: 'GET', path: '/api/billing-console/reporting' },
      { method: 'POST', path: '/api/billing-console/validate' },
      { method: 'GET', path: '/api/billing-console/audit' }
    ],
    readiness: createBillingConsoleReadinessBoard(snapshot)
  };
}

export function createBillingConsoleRouteSummary(snapshot = buildBillingConsoleSnapshot()) {
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

