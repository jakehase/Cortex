import { createComplianceConsoleWorkspace, summarizeComplianceConsoleWorkspace, createComplianceConsoleNarratives, createComplianceConsoleCoverageGrid } from './domain-compliance-console.mjs';
import { createComplianceConsolePolicies, validateComplianceConsolePolicies, summarizeComplianceConsolePolicies, createComplianceConsoleEscalationDeck } from './policies-compliance-console.mjs';
import { createComplianceConsoleAnalyticsTimeline, createComplianceConsoleForecastEnvelope, createComplianceConsoleExceptionLedger, summarizeComplianceConsoleAnalytics } from './analytics-compliance-console.mjs';
import { createComplianceConsoleOperationsBoard, createComplianceConsoleShiftChecklist, createComplianceConsoleIncidentDeck } from './operations-compliance-console.mjs';
import { createComplianceConsoleReportCards, createComplianceConsoleReviewPackets, summarizeComplianceConsoleReporting } from './reporting-compliance-console.mjs';
import { createComplianceConsoleAuditTrail, createComplianceConsoleEvidenceManifest, createComplianceConsoleReadinessAttestation } from './audit-compliance-console.mjs';
import { createComplianceConsolePlaybooks, createComplianceConsoleDecisionDeck, createComplianceConsoleEscalationMoments } from './playbooks-compliance-console.mjs';

export function buildComplianceConsoleSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createComplianceConsoleWorkspace(workspaceName);
  const policies = createComplianceConsolePolicies();
  return {
    workspace,
    summary: summarizeComplianceConsoleWorkspace(workspace),
    narratives: createComplianceConsoleNarratives(workspace),
    coverage: createComplianceConsoleCoverageGrid(workspace),
    policies,
    policySummary: summarizeComplianceConsolePolicies(policies),
    validation: validateComplianceConsolePolicies(policies),
    escalationDeck: createComplianceConsoleEscalationDeck(policies),
    analytics: {
      timeline: createComplianceConsoleAnalyticsTimeline(),
      forecast: createComplianceConsoleForecastEnvelope(),
      exceptions: createComplianceConsoleExceptionLedger(),
      summary: summarizeComplianceConsoleAnalytics()
    },
    operations: {
      board: createComplianceConsoleOperationsBoard(),
      checklist: createComplianceConsoleShiftChecklist(),
      incidents: createComplianceConsoleIncidentDeck()
    },
    reporting: {
      cards: createComplianceConsoleReportCards(),
      packets: createComplianceConsoleReviewPackets(),
      summary: summarizeComplianceConsoleReporting()
    },
    audit: {
      trail: createComplianceConsoleAuditTrail(),
      manifest: createComplianceConsoleEvidenceManifest(),
      attestation: createComplianceConsoleReadinessAttestation()
    },
    playbooks: createComplianceConsolePlaybooks(),
    decisions: createComplianceConsoleDecisionDeck(),
    escalationMoments: createComplianceConsoleEscalationMoments()
  };
}

export function createComplianceConsoleReadinessBoard(snapshot = buildComplianceConsoleSnapshot()) {
  return [
    { id: 'compliance-console-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'compliance-console-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'compliance-console-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'compliance-console-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createComplianceConsoleApiDocument(snapshot = buildComplianceConsoleSnapshot()) {
  return {
    id: 'compliance-console-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/compliance-console/overview' },
      { method: 'GET', path: '/api/compliance-console/reporting' },
      { method: 'POST', path: '/api/compliance-console/validate' },
      { method: 'GET', path: '/api/compliance-console/audit' }
    ],
    readiness: createComplianceConsoleReadinessBoard(snapshot)
  };
}

export function createComplianceConsoleRouteSummary(snapshot = buildComplianceConsoleSnapshot()) {
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

