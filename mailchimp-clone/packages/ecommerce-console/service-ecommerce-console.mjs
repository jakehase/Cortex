import { createEcommerceConsoleWorkspace, summarizeEcommerceConsoleWorkspace, createEcommerceConsoleNarratives, createEcommerceConsoleCoverageGrid } from './domain-ecommerce-console.mjs';
import { createEcommerceConsolePolicies, validateEcommerceConsolePolicies, summarizeEcommerceConsolePolicies, createEcommerceConsoleEscalationDeck } from './policies-ecommerce-console.mjs';
import { createEcommerceConsoleAnalyticsTimeline, createEcommerceConsoleForecastEnvelope, createEcommerceConsoleExceptionLedger, summarizeEcommerceConsoleAnalytics } from './analytics-ecommerce-console.mjs';
import { createEcommerceConsoleOperationsBoard, createEcommerceConsoleShiftChecklist, createEcommerceConsoleIncidentDeck } from './operations-ecommerce-console.mjs';
import { createEcommerceConsoleReportCards, createEcommerceConsoleReviewPackets, summarizeEcommerceConsoleReporting } from './reporting-ecommerce-console.mjs';
import { createEcommerceConsoleAuditTrail, createEcommerceConsoleEvidenceManifest, createEcommerceConsoleReadinessAttestation } from './audit-ecommerce-console.mjs';
import { createEcommerceConsolePlaybooks, createEcommerceConsoleDecisionDeck, createEcommerceConsoleEscalationMoments } from './playbooks-ecommerce-console.mjs';

export function buildEcommerceConsoleSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createEcommerceConsoleWorkspace(workspaceName);
  const policies = createEcommerceConsolePolicies();
  return {
    workspace,
    summary: summarizeEcommerceConsoleWorkspace(workspace),
    narratives: createEcommerceConsoleNarratives(workspace),
    coverage: createEcommerceConsoleCoverageGrid(workspace),
    policies,
    policySummary: summarizeEcommerceConsolePolicies(policies),
    validation: validateEcommerceConsolePolicies(policies),
    escalationDeck: createEcommerceConsoleEscalationDeck(policies),
    analytics: {
      timeline: createEcommerceConsoleAnalyticsTimeline(),
      forecast: createEcommerceConsoleForecastEnvelope(),
      exceptions: createEcommerceConsoleExceptionLedger(),
      summary: summarizeEcommerceConsoleAnalytics()
    },
    operations: {
      board: createEcommerceConsoleOperationsBoard(),
      checklist: createEcommerceConsoleShiftChecklist(),
      incidents: createEcommerceConsoleIncidentDeck()
    },
    reporting: {
      cards: createEcommerceConsoleReportCards(),
      packets: createEcommerceConsoleReviewPackets(),
      summary: summarizeEcommerceConsoleReporting()
    },
    audit: {
      trail: createEcommerceConsoleAuditTrail(),
      manifest: createEcommerceConsoleEvidenceManifest(),
      attestation: createEcommerceConsoleReadinessAttestation()
    },
    playbooks: createEcommerceConsolePlaybooks(),
    decisions: createEcommerceConsoleDecisionDeck(),
    escalationMoments: createEcommerceConsoleEscalationMoments()
  };
}

export function createEcommerceConsoleReadinessBoard(snapshot = buildEcommerceConsoleSnapshot()) {
  return [
    { id: 'ecommerce-console-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'ecommerce-console-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'ecommerce-console-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'ecommerce-console-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createEcommerceConsoleApiDocument(snapshot = buildEcommerceConsoleSnapshot()) {
  return {
    id: 'ecommerce-console-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/ecommerce-console/overview' },
      { method: 'GET', path: '/api/ecommerce-console/reporting' },
      { method: 'POST', path: '/api/ecommerce-console/validate' },
      { method: 'GET', path: '/api/ecommerce-console/audit' }
    ],
    readiness: createEcommerceConsoleReadinessBoard(snapshot)
  };
}

export function createEcommerceConsoleRouteSummary(snapshot = buildEcommerceConsoleSnapshot()) {
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

