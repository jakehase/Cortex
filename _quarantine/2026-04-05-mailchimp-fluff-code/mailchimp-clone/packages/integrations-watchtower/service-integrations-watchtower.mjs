import { createIntegrationsWatchtowerWorkspace, summarizeIntegrationsWatchtowerWorkspace, createIntegrationsWatchtowerNarratives, createIntegrationsWatchtowerCoverageGrid } from './domain-integrations-watchtower.mjs';
import { createIntegrationsWatchtowerPolicies, validateIntegrationsWatchtowerPolicies, summarizeIntegrationsWatchtowerPolicies, createIntegrationsWatchtowerEscalationDeck } from './policies-integrations-watchtower.mjs';
import { createIntegrationsWatchtowerAnalyticsTimeline, createIntegrationsWatchtowerForecastEnvelope, createIntegrationsWatchtowerExceptionLedger, summarizeIntegrationsWatchtowerAnalytics } from './analytics-integrations-watchtower.mjs';
import { createIntegrationsWatchtowerOperationsBoard, createIntegrationsWatchtowerShiftChecklist, createIntegrationsWatchtowerIncidentDeck } from './operations-integrations-watchtower.mjs';
import { createIntegrationsWatchtowerReportCards, createIntegrationsWatchtowerReviewPackets, summarizeIntegrationsWatchtowerReporting } from './reporting-integrations-watchtower.mjs';
import { createIntegrationsWatchtowerAuditTrail, createIntegrationsWatchtowerEvidenceManifest, createIntegrationsWatchtowerReadinessAttestation } from './audit-integrations-watchtower.mjs';
import { createIntegrationsWatchtowerPlaybooks, createIntegrationsWatchtowerDecisionDeck, createIntegrationsWatchtowerEscalationMoments } from './playbooks-integrations-watchtower.mjs';

export function buildIntegrationsWatchtowerSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createIntegrationsWatchtowerWorkspace(workspaceName);
  const policies = createIntegrationsWatchtowerPolicies();
  return {
    workspace,
    summary: summarizeIntegrationsWatchtowerWorkspace(workspace),
    narratives: createIntegrationsWatchtowerNarratives(workspace),
    coverage: createIntegrationsWatchtowerCoverageGrid(workspace),
    policies,
    policySummary: summarizeIntegrationsWatchtowerPolicies(policies),
    validation: validateIntegrationsWatchtowerPolicies(policies),
    escalationDeck: createIntegrationsWatchtowerEscalationDeck(policies),
    analytics: {
      timeline: createIntegrationsWatchtowerAnalyticsTimeline(),
      forecast: createIntegrationsWatchtowerForecastEnvelope(),
      exceptions: createIntegrationsWatchtowerExceptionLedger(),
      summary: summarizeIntegrationsWatchtowerAnalytics()
    },
    operations: {
      board: createIntegrationsWatchtowerOperationsBoard(),
      checklist: createIntegrationsWatchtowerShiftChecklist(),
      incidents: createIntegrationsWatchtowerIncidentDeck()
    },
    reporting: {
      cards: createIntegrationsWatchtowerReportCards(),
      packets: createIntegrationsWatchtowerReviewPackets(),
      summary: summarizeIntegrationsWatchtowerReporting()
    },
    audit: {
      trail: createIntegrationsWatchtowerAuditTrail(),
      manifest: createIntegrationsWatchtowerEvidenceManifest(),
      attestation: createIntegrationsWatchtowerReadinessAttestation()
    },
    playbooks: createIntegrationsWatchtowerPlaybooks(),
    decisions: createIntegrationsWatchtowerDecisionDeck(),
    escalationMoments: createIntegrationsWatchtowerEscalationMoments()
  };
}

export function createIntegrationsWatchtowerReadinessBoard(snapshot = buildIntegrationsWatchtowerSnapshot()) {
  return [
    { id: 'integrations-watchtower-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'integrations-watchtower-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'integrations-watchtower-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'integrations-watchtower-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createIntegrationsWatchtowerApiDocument(snapshot = buildIntegrationsWatchtowerSnapshot()) {
  return {
    id: 'integrations-watchtower-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/integrations-watchtower/overview' },
      { method: 'GET', path: '/api/integrations-watchtower/reporting' },
      { method: 'POST', path: '/api/integrations-watchtower/validate' },
      { method: 'GET', path: '/api/integrations-watchtower/audit' }
    ],
    readiness: createIntegrationsWatchtowerReadinessBoard(snapshot)
  };
}

export function createIntegrationsWatchtowerRouteSummary(snapshot = buildIntegrationsWatchtowerSnapshot()) {
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

