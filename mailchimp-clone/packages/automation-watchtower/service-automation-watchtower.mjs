import { createAutomationWatchtowerWorkspace, summarizeAutomationWatchtowerWorkspace, createAutomationWatchtowerNarratives, createAutomationWatchtowerCoverageGrid } from './domain-automation-watchtower.mjs';
import { createAutomationWatchtowerPolicies, validateAutomationWatchtowerPolicies, summarizeAutomationWatchtowerPolicies, createAutomationWatchtowerEscalationDeck } from './policies-automation-watchtower.mjs';
import { createAutomationWatchtowerAnalyticsTimeline, createAutomationWatchtowerForecastEnvelope, createAutomationWatchtowerExceptionLedger, summarizeAutomationWatchtowerAnalytics } from './analytics-automation-watchtower.mjs';
import { createAutomationWatchtowerOperationsBoard, createAutomationWatchtowerShiftChecklist, createAutomationWatchtowerIncidentDeck } from './operations-automation-watchtower.mjs';
import { createAutomationWatchtowerReportCards, createAutomationWatchtowerReviewPackets, summarizeAutomationWatchtowerReporting } from './reporting-automation-watchtower.mjs';
import { createAutomationWatchtowerAuditTrail, createAutomationWatchtowerEvidenceManifest, createAutomationWatchtowerReadinessAttestation } from './audit-automation-watchtower.mjs';
import { createAutomationWatchtowerPlaybooks, createAutomationWatchtowerDecisionDeck, createAutomationWatchtowerEscalationMoments } from './playbooks-automation-watchtower.mjs';

export function buildAutomationWatchtowerSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createAutomationWatchtowerWorkspace(workspaceName);
  const policies = createAutomationWatchtowerPolicies();
  return {
    workspace,
    summary: summarizeAutomationWatchtowerWorkspace(workspace),
    narratives: createAutomationWatchtowerNarratives(workspace),
    coverage: createAutomationWatchtowerCoverageGrid(workspace),
    policies,
    policySummary: summarizeAutomationWatchtowerPolicies(policies),
    validation: validateAutomationWatchtowerPolicies(policies),
    escalationDeck: createAutomationWatchtowerEscalationDeck(policies),
    analytics: {
      timeline: createAutomationWatchtowerAnalyticsTimeline(),
      forecast: createAutomationWatchtowerForecastEnvelope(),
      exceptions: createAutomationWatchtowerExceptionLedger(),
      summary: summarizeAutomationWatchtowerAnalytics()
    },
    operations: {
      board: createAutomationWatchtowerOperationsBoard(),
      checklist: createAutomationWatchtowerShiftChecklist(),
      incidents: createAutomationWatchtowerIncidentDeck()
    },
    reporting: {
      cards: createAutomationWatchtowerReportCards(),
      packets: createAutomationWatchtowerReviewPackets(),
      summary: summarizeAutomationWatchtowerReporting()
    },
    audit: {
      trail: createAutomationWatchtowerAuditTrail(),
      manifest: createAutomationWatchtowerEvidenceManifest(),
      attestation: createAutomationWatchtowerReadinessAttestation()
    },
    playbooks: createAutomationWatchtowerPlaybooks(),
    decisions: createAutomationWatchtowerDecisionDeck(),
    escalationMoments: createAutomationWatchtowerEscalationMoments()
  };
}

export function createAutomationWatchtowerReadinessBoard(snapshot = buildAutomationWatchtowerSnapshot()) {
  return [
    { id: 'automation-watchtower-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'automation-watchtower-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'automation-watchtower-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'automation-watchtower-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createAutomationWatchtowerApiDocument(snapshot = buildAutomationWatchtowerSnapshot()) {
  return {
    id: 'automation-watchtower-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/automation-watchtower/overview' },
      { method: 'GET', path: '/api/automation-watchtower/reporting' },
      { method: 'POST', path: '/api/automation-watchtower/validate' },
      { method: 'GET', path: '/api/automation-watchtower/audit' }
    ],
    readiness: createAutomationWatchtowerReadinessBoard(snapshot)
  };
}

export function createAutomationWatchtowerRouteSummary(snapshot = buildAutomationWatchtowerSnapshot()) {
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

