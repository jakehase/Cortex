import { createCustomerConsoleWorkspace, summarizeCustomerConsoleWorkspace, createCustomerConsoleNarratives, createCustomerConsoleCoverageGrid } from './domain-customer-console.mjs';
import { createCustomerConsolePolicies, validateCustomerConsolePolicies, summarizeCustomerConsolePolicies, createCustomerConsoleEscalationDeck } from './policies-customer-console.mjs';
import { createCustomerConsoleAnalyticsTimeline, createCustomerConsoleForecastEnvelope, createCustomerConsoleExceptionLedger, summarizeCustomerConsoleAnalytics } from './analytics-customer-console.mjs';
import { createCustomerConsoleOperationsBoard, createCustomerConsoleShiftChecklist, createCustomerConsoleIncidentDeck } from './operations-customer-console.mjs';
import { createCustomerConsoleReportCards, createCustomerConsoleReviewPackets, summarizeCustomerConsoleReporting } from './reporting-customer-console.mjs';
import { createCustomerConsoleAuditTrail, createCustomerConsoleEvidenceManifest, createCustomerConsoleReadinessAttestation } from './audit-customer-console.mjs';
import { createCustomerConsolePlaybooks, createCustomerConsoleDecisionDeck, createCustomerConsoleEscalationMoments } from './playbooks-customer-console.mjs';

export function buildCustomerConsoleSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createCustomerConsoleWorkspace(workspaceName);
  const policies = createCustomerConsolePolicies();
  return {
    workspace,
    summary: summarizeCustomerConsoleWorkspace(workspace),
    narratives: createCustomerConsoleNarratives(workspace),
    coverage: createCustomerConsoleCoverageGrid(workspace),
    policies,
    policySummary: summarizeCustomerConsolePolicies(policies),
    validation: validateCustomerConsolePolicies(policies),
    escalationDeck: createCustomerConsoleEscalationDeck(policies),
    analytics: {
      timeline: createCustomerConsoleAnalyticsTimeline(),
      forecast: createCustomerConsoleForecastEnvelope(),
      exceptions: createCustomerConsoleExceptionLedger(),
      summary: summarizeCustomerConsoleAnalytics()
    },
    operations: {
      board: createCustomerConsoleOperationsBoard(),
      checklist: createCustomerConsoleShiftChecklist(),
      incidents: createCustomerConsoleIncidentDeck()
    },
    reporting: {
      cards: createCustomerConsoleReportCards(),
      packets: createCustomerConsoleReviewPackets(),
      summary: summarizeCustomerConsoleReporting()
    },
    audit: {
      trail: createCustomerConsoleAuditTrail(),
      manifest: createCustomerConsoleEvidenceManifest(),
      attestation: createCustomerConsoleReadinessAttestation()
    },
    playbooks: createCustomerConsolePlaybooks(),
    decisions: createCustomerConsoleDecisionDeck(),
    escalationMoments: createCustomerConsoleEscalationMoments()
  };
}

export function createCustomerConsoleReadinessBoard(snapshot = buildCustomerConsoleSnapshot()) {
  return [
    { id: 'customer-console-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'customer-console-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'customer-console-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'customer-console-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createCustomerConsoleApiDocument(snapshot = buildCustomerConsoleSnapshot()) {
  return {
    id: 'customer-console-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/customer-console/overview' },
      { method: 'GET', path: '/api/customer-console/reporting' },
      { method: 'POST', path: '/api/customer-console/validate' },
      { method: 'GET', path: '/api/customer-console/audit' }
    ],
    readiness: createCustomerConsoleReadinessBoard(snapshot)
  };
}

export function createCustomerConsoleRouteSummary(snapshot = buildCustomerConsoleSnapshot()) {
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

