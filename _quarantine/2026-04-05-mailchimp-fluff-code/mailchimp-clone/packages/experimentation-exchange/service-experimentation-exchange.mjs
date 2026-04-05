import { createExperimentationExchangeWorkspace, summarizeExperimentationExchangeWorkspace, createExperimentationExchangeNarratives, createExperimentationExchangeCoverageGrid } from './domain-experimentation-exchange.mjs';
import { createExperimentationExchangePolicies, validateExperimentationExchangePolicies, summarizeExperimentationExchangePolicies, createExperimentationExchangeEscalationDeck } from './policies-experimentation-exchange.mjs';
import { createExperimentationExchangeAnalyticsTimeline, createExperimentationExchangeForecastEnvelope, createExperimentationExchangeExceptionLedger, summarizeExperimentationExchangeAnalytics } from './analytics-experimentation-exchange.mjs';
import { createExperimentationExchangeOperationsBoard, createExperimentationExchangeShiftChecklist, createExperimentationExchangeIncidentDeck } from './operations-experimentation-exchange.mjs';
import { createExperimentationExchangeReportCards, createExperimentationExchangeReviewPackets, summarizeExperimentationExchangeReporting } from './reporting-experimentation-exchange.mjs';
import { createExperimentationExchangeAuditTrail, createExperimentationExchangeEvidenceManifest, createExperimentationExchangeReadinessAttestation } from './audit-experimentation-exchange.mjs';
import { createExperimentationExchangePlaybooks, createExperimentationExchangeDecisionDeck, createExperimentationExchangeEscalationMoments } from './playbooks-experimentation-exchange.mjs';

export function buildExperimentationExchangeSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createExperimentationExchangeWorkspace(workspaceName);
  const policies = createExperimentationExchangePolicies();
  return {
    workspace,
    summary: summarizeExperimentationExchangeWorkspace(workspace),
    narratives: createExperimentationExchangeNarratives(workspace),
    coverage: createExperimentationExchangeCoverageGrid(workspace),
    policies,
    policySummary: summarizeExperimentationExchangePolicies(policies),
    validation: validateExperimentationExchangePolicies(policies),
    escalationDeck: createExperimentationExchangeEscalationDeck(policies),
    analytics: {
      timeline: createExperimentationExchangeAnalyticsTimeline(),
      forecast: createExperimentationExchangeForecastEnvelope(),
      exceptions: createExperimentationExchangeExceptionLedger(),
      summary: summarizeExperimentationExchangeAnalytics()
    },
    operations: {
      board: createExperimentationExchangeOperationsBoard(),
      checklist: createExperimentationExchangeShiftChecklist(),
      incidents: createExperimentationExchangeIncidentDeck()
    },
    reporting: {
      cards: createExperimentationExchangeReportCards(),
      packets: createExperimentationExchangeReviewPackets(),
      summary: summarizeExperimentationExchangeReporting()
    },
    audit: {
      trail: createExperimentationExchangeAuditTrail(),
      manifest: createExperimentationExchangeEvidenceManifest(),
      attestation: createExperimentationExchangeReadinessAttestation()
    },
    playbooks: createExperimentationExchangePlaybooks(),
    decisions: createExperimentationExchangeDecisionDeck(),
    escalationMoments: createExperimentationExchangeEscalationMoments()
  };
}

export function createExperimentationExchangeReadinessBoard(snapshot = buildExperimentationExchangeSnapshot()) {
  return [
    { id: 'experimentation-exchange-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'experimentation-exchange-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'experimentation-exchange-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'experimentation-exchange-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createExperimentationExchangeApiDocument(snapshot = buildExperimentationExchangeSnapshot()) {
  return {
    id: 'experimentation-exchange-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/experimentation-exchange/overview' },
      { method: 'GET', path: '/api/experimentation-exchange/reporting' },
      { method: 'POST', path: '/api/experimentation-exchange/validate' },
      { method: 'GET', path: '/api/experimentation-exchange/audit' }
    ],
    readiness: createExperimentationExchangeReadinessBoard(snapshot)
  };
}

export function createExperimentationExchangeRouteSummary(snapshot = buildExperimentationExchangeSnapshot()) {
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

