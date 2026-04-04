import { createLocalizationWatchtowerWorkspace, summarizeLocalizationWatchtowerWorkspace, createLocalizationWatchtowerNarratives, createLocalizationWatchtowerCoverageGrid } from './domain-localization-watchtower.mjs';
import { createLocalizationWatchtowerPolicies, validateLocalizationWatchtowerPolicies, summarizeLocalizationWatchtowerPolicies, createLocalizationWatchtowerEscalationDeck } from './policies-localization-watchtower.mjs';
import { createLocalizationWatchtowerAnalyticsTimeline, createLocalizationWatchtowerForecastEnvelope, createLocalizationWatchtowerExceptionLedger, summarizeLocalizationWatchtowerAnalytics } from './analytics-localization-watchtower.mjs';
import { createLocalizationWatchtowerOperationsBoard, createLocalizationWatchtowerShiftChecklist, createLocalizationWatchtowerIncidentDeck } from './operations-localization-watchtower.mjs';
import { createLocalizationWatchtowerReportCards, createLocalizationWatchtowerReviewPackets, summarizeLocalizationWatchtowerReporting } from './reporting-localization-watchtower.mjs';
import { createLocalizationWatchtowerAuditTrail, createLocalizationWatchtowerEvidenceManifest, createLocalizationWatchtowerReadinessAttestation } from './audit-localization-watchtower.mjs';
import { createLocalizationWatchtowerPlaybooks, createLocalizationWatchtowerDecisionDeck, createLocalizationWatchtowerEscalationMoments } from './playbooks-localization-watchtower.mjs';

export function buildLocalizationWatchtowerSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createLocalizationWatchtowerWorkspace(workspaceName);
  const policies = createLocalizationWatchtowerPolicies();
  return {
    workspace,
    summary: summarizeLocalizationWatchtowerWorkspace(workspace),
    narratives: createLocalizationWatchtowerNarratives(workspace),
    coverage: createLocalizationWatchtowerCoverageGrid(workspace),
    policies,
    policySummary: summarizeLocalizationWatchtowerPolicies(policies),
    validation: validateLocalizationWatchtowerPolicies(policies),
    escalationDeck: createLocalizationWatchtowerEscalationDeck(policies),
    analytics: {
      timeline: createLocalizationWatchtowerAnalyticsTimeline(),
      forecast: createLocalizationWatchtowerForecastEnvelope(),
      exceptions: createLocalizationWatchtowerExceptionLedger(),
      summary: summarizeLocalizationWatchtowerAnalytics()
    },
    operations: {
      board: createLocalizationWatchtowerOperationsBoard(),
      checklist: createLocalizationWatchtowerShiftChecklist(),
      incidents: createLocalizationWatchtowerIncidentDeck()
    },
    reporting: {
      cards: createLocalizationWatchtowerReportCards(),
      packets: createLocalizationWatchtowerReviewPackets(),
      summary: summarizeLocalizationWatchtowerReporting()
    },
    audit: {
      trail: createLocalizationWatchtowerAuditTrail(),
      manifest: createLocalizationWatchtowerEvidenceManifest(),
      attestation: createLocalizationWatchtowerReadinessAttestation()
    },
    playbooks: createLocalizationWatchtowerPlaybooks(),
    decisions: createLocalizationWatchtowerDecisionDeck(),
    escalationMoments: createLocalizationWatchtowerEscalationMoments()
  };
}

export function createLocalizationWatchtowerReadinessBoard(snapshot = buildLocalizationWatchtowerSnapshot()) {
  return [
    { id: 'localization-watchtower-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'localization-watchtower-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'localization-watchtower-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'localization-watchtower-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createLocalizationWatchtowerApiDocument(snapshot = buildLocalizationWatchtowerSnapshot()) {
  return {
    id: 'localization-watchtower-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/localization-watchtower/overview' },
      { method: 'GET', path: '/api/localization-watchtower/reporting' },
      { method: 'POST', path: '/api/localization-watchtower/validate' },
      { method: 'GET', path: '/api/localization-watchtower/audit' }
    ],
    readiness: createLocalizationWatchtowerReadinessBoard(snapshot)
  };
}

export function createLocalizationWatchtowerRouteSummary(snapshot = buildLocalizationWatchtowerSnapshot()) {
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

