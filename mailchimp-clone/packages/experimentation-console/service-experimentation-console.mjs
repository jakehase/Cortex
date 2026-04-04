import { createExperimentationConsoleWorkspace, summarizeExperimentationConsoleWorkspace, createExperimentationConsoleNarratives, createExperimentationConsoleCoverageGrid } from './domain-experimentation-console.mjs';
import { createExperimentationConsolePolicies, validateExperimentationConsolePolicies, summarizeExperimentationConsolePolicies, createExperimentationConsoleEscalationDeck } from './policies-experimentation-console.mjs';
import { createExperimentationConsoleAnalyticsTimeline, createExperimentationConsoleForecastEnvelope, createExperimentationConsoleExceptionLedger, summarizeExperimentationConsoleAnalytics } from './analytics-experimentation-console.mjs';
import { createExperimentationConsoleOperationsBoard, createExperimentationConsoleShiftChecklist, createExperimentationConsoleIncidentDeck } from './operations-experimentation-console.mjs';
import { createExperimentationConsoleReportCards, createExperimentationConsoleReviewPackets, summarizeExperimentationConsoleReporting } from './reporting-experimentation-console.mjs';
import { createExperimentationConsoleAuditTrail, createExperimentationConsoleEvidenceManifest, createExperimentationConsoleReadinessAttestation } from './audit-experimentation-console.mjs';
import { createExperimentationConsolePlaybooks, createExperimentationConsoleDecisionDeck, createExperimentationConsoleEscalationMoments } from './playbooks-experimentation-console.mjs';

export function buildExperimentationConsoleSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createExperimentationConsoleWorkspace(workspaceName);
  const policies = createExperimentationConsolePolicies();
  return {
    workspace,
    summary: summarizeExperimentationConsoleWorkspace(workspace),
    narratives: createExperimentationConsoleNarratives(workspace),
    coverage: createExperimentationConsoleCoverageGrid(workspace),
    policies,
    policySummary: summarizeExperimentationConsolePolicies(policies),
    validation: validateExperimentationConsolePolicies(policies),
    escalationDeck: createExperimentationConsoleEscalationDeck(policies),
    analytics: {
      timeline: createExperimentationConsoleAnalyticsTimeline(),
      forecast: createExperimentationConsoleForecastEnvelope(),
      exceptions: createExperimentationConsoleExceptionLedger(),
      summary: summarizeExperimentationConsoleAnalytics()
    },
    operations: {
      board: createExperimentationConsoleOperationsBoard(),
      checklist: createExperimentationConsoleShiftChecklist(),
      incidents: createExperimentationConsoleIncidentDeck()
    },
    reporting: {
      cards: createExperimentationConsoleReportCards(),
      packets: createExperimentationConsoleReviewPackets(),
      summary: summarizeExperimentationConsoleReporting()
    },
    audit: {
      trail: createExperimentationConsoleAuditTrail(),
      manifest: createExperimentationConsoleEvidenceManifest(),
      attestation: createExperimentationConsoleReadinessAttestation()
    },
    playbooks: createExperimentationConsolePlaybooks(),
    decisions: createExperimentationConsoleDecisionDeck(),
    escalationMoments: createExperimentationConsoleEscalationMoments()
  };
}

export function createExperimentationConsoleReadinessBoard(snapshot = buildExperimentationConsoleSnapshot()) {
  return [
    { id: 'experimentation-console-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'experimentation-console-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'experimentation-console-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'experimentation-console-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createExperimentationConsoleApiDocument(snapshot = buildExperimentationConsoleSnapshot()) {
  return {
    id: 'experimentation-console-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/experimentation-console/overview' },
      { method: 'GET', path: '/api/experimentation-console/reporting' },
      { method: 'POST', path: '/api/experimentation-console/validate' },
      { method: 'GET', path: '/api/experimentation-console/audit' }
    ],
    readiness: createExperimentationConsoleReadinessBoard(snapshot)
  };
}

export function createExperimentationConsoleRouteSummary(snapshot = buildExperimentationConsoleSnapshot()) {
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

