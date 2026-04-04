import { createCommerceConsoleWorkspace, summarizeCommerceConsoleWorkspace, createCommerceConsoleNarratives, createCommerceConsoleCoverageGrid } from './domain-commerce-console.mjs';
import { createCommerceConsolePolicies, validateCommerceConsolePolicies, summarizeCommerceConsolePolicies, createCommerceConsoleEscalationDeck } from './policies-commerce-console.mjs';
import { createCommerceConsoleAnalyticsTimeline, createCommerceConsoleForecastEnvelope, createCommerceConsoleExceptionLedger, summarizeCommerceConsoleAnalytics } from './analytics-commerce-console.mjs';
import { createCommerceConsoleOperationsBoard, createCommerceConsoleShiftChecklist, createCommerceConsoleIncidentDeck } from './operations-commerce-console.mjs';
import { createCommerceConsoleReportCards, createCommerceConsoleReviewPackets, summarizeCommerceConsoleReporting } from './reporting-commerce-console.mjs';
import { createCommerceConsoleAuditTrail, createCommerceConsoleEvidenceManifest, createCommerceConsoleReadinessAttestation } from './audit-commerce-console.mjs';
import { createCommerceConsolePlaybooks, createCommerceConsoleDecisionDeck, createCommerceConsoleEscalationMoments } from './playbooks-commerce-console.mjs';

export function buildCommerceConsoleSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createCommerceConsoleWorkspace(workspaceName);
  const policies = createCommerceConsolePolicies();
  return {
    workspace,
    summary: summarizeCommerceConsoleWorkspace(workspace),
    narratives: createCommerceConsoleNarratives(workspace),
    coverage: createCommerceConsoleCoverageGrid(workspace),
    policies,
    policySummary: summarizeCommerceConsolePolicies(policies),
    validation: validateCommerceConsolePolicies(policies),
    escalationDeck: createCommerceConsoleEscalationDeck(policies),
    analytics: {
      timeline: createCommerceConsoleAnalyticsTimeline(),
      forecast: createCommerceConsoleForecastEnvelope(),
      exceptions: createCommerceConsoleExceptionLedger(),
      summary: summarizeCommerceConsoleAnalytics()
    },
    operations: {
      board: createCommerceConsoleOperationsBoard(),
      checklist: createCommerceConsoleShiftChecklist(),
      incidents: createCommerceConsoleIncidentDeck()
    },
    reporting: {
      cards: createCommerceConsoleReportCards(),
      packets: createCommerceConsoleReviewPackets(),
      summary: summarizeCommerceConsoleReporting()
    },
    audit: {
      trail: createCommerceConsoleAuditTrail(),
      manifest: createCommerceConsoleEvidenceManifest(),
      attestation: createCommerceConsoleReadinessAttestation()
    },
    playbooks: createCommerceConsolePlaybooks(),
    decisions: createCommerceConsoleDecisionDeck(),
    escalationMoments: createCommerceConsoleEscalationMoments()
  };
}

export function createCommerceConsoleReadinessBoard(snapshot = buildCommerceConsoleSnapshot()) {
  return [
    { id: 'commerce-console-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'commerce-console-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'commerce-console-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'commerce-console-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createCommerceConsoleApiDocument(snapshot = buildCommerceConsoleSnapshot()) {
  return {
    id: 'commerce-console-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/commerce-console/overview' },
      { method: 'GET', path: '/api/commerce-console/reporting' },
      { method: 'POST', path: '/api/commerce-console/validate' },
      { method: 'GET', path: '/api/commerce-console/audit' }
    ],
    readiness: createCommerceConsoleReadinessBoard(snapshot)
  };
}

export function createCommerceConsoleRouteSummary(snapshot = buildCommerceConsoleSnapshot()) {
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

