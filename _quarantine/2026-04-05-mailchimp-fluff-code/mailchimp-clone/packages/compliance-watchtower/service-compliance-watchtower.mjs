import { createComplianceWatchtowerWorkspace, summarizeComplianceWatchtowerWorkspace, createComplianceWatchtowerNarratives, createComplianceWatchtowerCoverageGrid } from './domain-compliance-watchtower.mjs';
import { createComplianceWatchtowerPolicies, validateComplianceWatchtowerPolicies, summarizeComplianceWatchtowerPolicies, createComplianceWatchtowerEscalationDeck } from './policies-compliance-watchtower.mjs';
import { createComplianceWatchtowerAnalyticsTimeline, createComplianceWatchtowerForecastEnvelope, createComplianceWatchtowerExceptionLedger, summarizeComplianceWatchtowerAnalytics } from './analytics-compliance-watchtower.mjs';
import { createComplianceWatchtowerOperationsBoard, createComplianceWatchtowerShiftChecklist, createComplianceWatchtowerIncidentDeck } from './operations-compliance-watchtower.mjs';
import { createComplianceWatchtowerReportCards, createComplianceWatchtowerReviewPackets, summarizeComplianceWatchtowerReporting } from './reporting-compliance-watchtower.mjs';
import { createComplianceWatchtowerAuditTrail, createComplianceWatchtowerEvidenceManifest, createComplianceWatchtowerReadinessAttestation } from './audit-compliance-watchtower.mjs';
import { createComplianceWatchtowerPlaybooks, createComplianceWatchtowerDecisionDeck, createComplianceWatchtowerEscalationMoments } from './playbooks-compliance-watchtower.mjs';

export function buildComplianceWatchtowerSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createComplianceWatchtowerWorkspace(workspaceName);
  const policies = createComplianceWatchtowerPolicies();
  return {
    workspace,
    summary: summarizeComplianceWatchtowerWorkspace(workspace),
    narratives: createComplianceWatchtowerNarratives(workspace),
    coverage: createComplianceWatchtowerCoverageGrid(workspace),
    policies,
    policySummary: summarizeComplianceWatchtowerPolicies(policies),
    validation: validateComplianceWatchtowerPolicies(policies),
    escalationDeck: createComplianceWatchtowerEscalationDeck(policies),
    analytics: {
      timeline: createComplianceWatchtowerAnalyticsTimeline(),
      forecast: createComplianceWatchtowerForecastEnvelope(),
      exceptions: createComplianceWatchtowerExceptionLedger(),
      summary: summarizeComplianceWatchtowerAnalytics()
    },
    operations: {
      board: createComplianceWatchtowerOperationsBoard(),
      checklist: createComplianceWatchtowerShiftChecklist(),
      incidents: createComplianceWatchtowerIncidentDeck()
    },
    reporting: {
      cards: createComplianceWatchtowerReportCards(),
      packets: createComplianceWatchtowerReviewPackets(),
      summary: summarizeComplianceWatchtowerReporting()
    },
    audit: {
      trail: createComplianceWatchtowerAuditTrail(),
      manifest: createComplianceWatchtowerEvidenceManifest(),
      attestation: createComplianceWatchtowerReadinessAttestation()
    },
    playbooks: createComplianceWatchtowerPlaybooks(),
    decisions: createComplianceWatchtowerDecisionDeck(),
    escalationMoments: createComplianceWatchtowerEscalationMoments()
  };
}

export function createComplianceWatchtowerReadinessBoard(snapshot = buildComplianceWatchtowerSnapshot()) {
  return [
    { id: 'compliance-watchtower-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'compliance-watchtower-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'compliance-watchtower-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'compliance-watchtower-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createComplianceWatchtowerApiDocument(snapshot = buildComplianceWatchtowerSnapshot()) {
  return {
    id: 'compliance-watchtower-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/compliance-watchtower/overview' },
      { method: 'GET', path: '/api/compliance-watchtower/reporting' },
      { method: 'POST', path: '/api/compliance-watchtower/validate' },
      { method: 'GET', path: '/api/compliance-watchtower/audit' }
    ],
    readiness: createComplianceWatchtowerReadinessBoard(snapshot)
  };
}

export function createComplianceWatchtowerRouteSummary(snapshot = buildComplianceWatchtowerSnapshot()) {
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

