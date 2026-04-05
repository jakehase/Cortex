import { createIntegrationsExchangeWorkspace, summarizeIntegrationsExchangeWorkspace, createIntegrationsExchangeNarratives, createIntegrationsExchangeCoverageGrid } from './domain-integrations-exchange.mjs';
import { createIntegrationsExchangePolicies, validateIntegrationsExchangePolicies, summarizeIntegrationsExchangePolicies, createIntegrationsExchangeEscalationDeck } from './policies-integrations-exchange.mjs';
import { createIntegrationsExchangeAnalyticsTimeline, createIntegrationsExchangeForecastEnvelope, createIntegrationsExchangeExceptionLedger, summarizeIntegrationsExchangeAnalytics } from './analytics-integrations-exchange.mjs';
import { createIntegrationsExchangeOperationsBoard, createIntegrationsExchangeShiftChecklist, createIntegrationsExchangeIncidentDeck } from './operations-integrations-exchange.mjs';
import { createIntegrationsExchangeReportCards, createIntegrationsExchangeReviewPackets, summarizeIntegrationsExchangeReporting } from './reporting-integrations-exchange.mjs';
import { createIntegrationsExchangeAuditTrail, createIntegrationsExchangeEvidenceManifest, createIntegrationsExchangeReadinessAttestation } from './audit-integrations-exchange.mjs';
import { createIntegrationsExchangePlaybooks, createIntegrationsExchangeDecisionDeck, createIntegrationsExchangeEscalationMoments } from './playbooks-integrations-exchange.mjs';

export function buildIntegrationsExchangeSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createIntegrationsExchangeWorkspace(workspaceName);
  const policies = createIntegrationsExchangePolicies();
  return {
    workspace,
    summary: summarizeIntegrationsExchangeWorkspace(workspace),
    narratives: createIntegrationsExchangeNarratives(workspace),
    coverage: createIntegrationsExchangeCoverageGrid(workspace),
    policies,
    policySummary: summarizeIntegrationsExchangePolicies(policies),
    validation: validateIntegrationsExchangePolicies(policies),
    escalationDeck: createIntegrationsExchangeEscalationDeck(policies),
    analytics: {
      timeline: createIntegrationsExchangeAnalyticsTimeline(),
      forecast: createIntegrationsExchangeForecastEnvelope(),
      exceptions: createIntegrationsExchangeExceptionLedger(),
      summary: summarizeIntegrationsExchangeAnalytics()
    },
    operations: {
      board: createIntegrationsExchangeOperationsBoard(),
      checklist: createIntegrationsExchangeShiftChecklist(),
      incidents: createIntegrationsExchangeIncidentDeck()
    },
    reporting: {
      cards: createIntegrationsExchangeReportCards(),
      packets: createIntegrationsExchangeReviewPackets(),
      summary: summarizeIntegrationsExchangeReporting()
    },
    audit: {
      trail: createIntegrationsExchangeAuditTrail(),
      manifest: createIntegrationsExchangeEvidenceManifest(),
      attestation: createIntegrationsExchangeReadinessAttestation()
    },
    playbooks: createIntegrationsExchangePlaybooks(),
    decisions: createIntegrationsExchangeDecisionDeck(),
    escalationMoments: createIntegrationsExchangeEscalationMoments()
  };
}

export function createIntegrationsExchangeReadinessBoard(snapshot = buildIntegrationsExchangeSnapshot()) {
  return [
    { id: 'integrations-exchange-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'integrations-exchange-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'integrations-exchange-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'integrations-exchange-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createIntegrationsExchangeApiDocument(snapshot = buildIntegrationsExchangeSnapshot()) {
  return {
    id: 'integrations-exchange-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/integrations-exchange/overview' },
      { method: 'GET', path: '/api/integrations-exchange/reporting' },
      { method: 'POST', path: '/api/integrations-exchange/validate' },
      { method: 'GET', path: '/api/integrations-exchange/audit' }
    ],
    readiness: createIntegrationsExchangeReadinessBoard(snapshot)
  };
}

export function createIntegrationsExchangeRouteSummary(snapshot = buildIntegrationsExchangeSnapshot()) {
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

