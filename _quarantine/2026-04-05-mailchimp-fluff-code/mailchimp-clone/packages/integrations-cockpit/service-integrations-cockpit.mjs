import { createIntegrationsCockpitWorkspace, summarizeIntegrationsCockpitWorkspace, createIntegrationsCockpitNarratives, createIntegrationsCockpitCoverageGrid } from './domain-integrations-cockpit.mjs';
import { createIntegrationsCockpitPolicies, validateIntegrationsCockpitPolicies, summarizeIntegrationsCockpitPolicies, createIntegrationsCockpitEscalationDeck } from './policies-integrations-cockpit.mjs';
import { createIntegrationsCockpitAnalyticsTimeline, createIntegrationsCockpitForecastEnvelope, createIntegrationsCockpitExceptionLedger, summarizeIntegrationsCockpitAnalytics } from './analytics-integrations-cockpit.mjs';
import { createIntegrationsCockpitOperationsBoard, createIntegrationsCockpitShiftChecklist, createIntegrationsCockpitIncidentDeck } from './operations-integrations-cockpit.mjs';
import { createIntegrationsCockpitReportCards, createIntegrationsCockpitReviewPackets, summarizeIntegrationsCockpitReporting } from './reporting-integrations-cockpit.mjs';
import { createIntegrationsCockpitAuditTrail, createIntegrationsCockpitEvidenceManifest, createIntegrationsCockpitReadinessAttestation } from './audit-integrations-cockpit.mjs';
import { createIntegrationsCockpitPlaybooks, createIntegrationsCockpitDecisionDeck, createIntegrationsCockpitEscalationMoments } from './playbooks-integrations-cockpit.mjs';

export function buildIntegrationsCockpitSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createIntegrationsCockpitWorkspace(workspaceName);
  const policies = createIntegrationsCockpitPolicies();
  return {
    workspace,
    summary: summarizeIntegrationsCockpitWorkspace(workspace),
    narratives: createIntegrationsCockpitNarratives(workspace),
    coverage: createIntegrationsCockpitCoverageGrid(workspace),
    policies,
    policySummary: summarizeIntegrationsCockpitPolicies(policies),
    validation: validateIntegrationsCockpitPolicies(policies),
    escalationDeck: createIntegrationsCockpitEscalationDeck(policies),
    analytics: {
      timeline: createIntegrationsCockpitAnalyticsTimeline(),
      forecast: createIntegrationsCockpitForecastEnvelope(),
      exceptions: createIntegrationsCockpitExceptionLedger(),
      summary: summarizeIntegrationsCockpitAnalytics()
    },
    operations: {
      board: createIntegrationsCockpitOperationsBoard(),
      checklist: createIntegrationsCockpitShiftChecklist(),
      incidents: createIntegrationsCockpitIncidentDeck()
    },
    reporting: {
      cards: createIntegrationsCockpitReportCards(),
      packets: createIntegrationsCockpitReviewPackets(),
      summary: summarizeIntegrationsCockpitReporting()
    },
    audit: {
      trail: createIntegrationsCockpitAuditTrail(),
      manifest: createIntegrationsCockpitEvidenceManifest(),
      attestation: createIntegrationsCockpitReadinessAttestation()
    },
    playbooks: createIntegrationsCockpitPlaybooks(),
    decisions: createIntegrationsCockpitDecisionDeck(),
    escalationMoments: createIntegrationsCockpitEscalationMoments()
  };
}

export function createIntegrationsCockpitReadinessBoard(snapshot = buildIntegrationsCockpitSnapshot()) {
  return [
    { id: 'integrations-cockpit-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'integrations-cockpit-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'integrations-cockpit-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'integrations-cockpit-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createIntegrationsCockpitApiDocument(snapshot = buildIntegrationsCockpitSnapshot()) {
  return {
    id: 'integrations-cockpit-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/integrations-cockpit/overview' },
      { method: 'GET', path: '/api/integrations-cockpit/reporting' },
      { method: 'POST', path: '/api/integrations-cockpit/validate' },
      { method: 'GET', path: '/api/integrations-cockpit/audit' }
    ],
    readiness: createIntegrationsCockpitReadinessBoard(snapshot)
  };
}

export function createIntegrationsCockpitRouteSummary(snapshot = buildIntegrationsCockpitSnapshot()) {
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

