import { createIntegrationsNavigatorWorkspace, summarizeIntegrationsNavigatorWorkspace, createIntegrationsNavigatorNarratives, createIntegrationsNavigatorCoverageGrid } from './domain-integrations-navigator.mjs';
import { createIntegrationsNavigatorPolicies, validateIntegrationsNavigatorPolicies, summarizeIntegrationsNavigatorPolicies, createIntegrationsNavigatorEscalationDeck } from './policies-integrations-navigator.mjs';
import { createIntegrationsNavigatorAnalyticsTimeline, createIntegrationsNavigatorForecastEnvelope, createIntegrationsNavigatorExceptionLedger, summarizeIntegrationsNavigatorAnalytics } from './analytics-integrations-navigator.mjs';
import { createIntegrationsNavigatorOperationsBoard, createIntegrationsNavigatorShiftChecklist, createIntegrationsNavigatorIncidentDeck } from './operations-integrations-navigator.mjs';
import { createIntegrationsNavigatorReportCards, createIntegrationsNavigatorReviewPackets, summarizeIntegrationsNavigatorReporting } from './reporting-integrations-navigator.mjs';
import { createIntegrationsNavigatorAuditTrail, createIntegrationsNavigatorEvidenceManifest, createIntegrationsNavigatorReadinessAttestation } from './audit-integrations-navigator.mjs';
import { createIntegrationsNavigatorPlaybooks, createIntegrationsNavigatorDecisionDeck, createIntegrationsNavigatorEscalationMoments } from './playbooks-integrations-navigator.mjs';

export function buildIntegrationsNavigatorSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createIntegrationsNavigatorWorkspace(workspaceName);
  const policies = createIntegrationsNavigatorPolicies();
  return {
    workspace,
    summary: summarizeIntegrationsNavigatorWorkspace(workspace),
    narratives: createIntegrationsNavigatorNarratives(workspace),
    coverage: createIntegrationsNavigatorCoverageGrid(workspace),
    policies,
    policySummary: summarizeIntegrationsNavigatorPolicies(policies),
    validation: validateIntegrationsNavigatorPolicies(policies),
    escalationDeck: createIntegrationsNavigatorEscalationDeck(policies),
    analytics: {
      timeline: createIntegrationsNavigatorAnalyticsTimeline(),
      forecast: createIntegrationsNavigatorForecastEnvelope(),
      exceptions: createIntegrationsNavigatorExceptionLedger(),
      summary: summarizeIntegrationsNavigatorAnalytics()
    },
    operations: {
      board: createIntegrationsNavigatorOperationsBoard(),
      checklist: createIntegrationsNavigatorShiftChecklist(),
      incidents: createIntegrationsNavigatorIncidentDeck()
    },
    reporting: {
      cards: createIntegrationsNavigatorReportCards(),
      packets: createIntegrationsNavigatorReviewPackets(),
      summary: summarizeIntegrationsNavigatorReporting()
    },
    audit: {
      trail: createIntegrationsNavigatorAuditTrail(),
      manifest: createIntegrationsNavigatorEvidenceManifest(),
      attestation: createIntegrationsNavigatorReadinessAttestation()
    },
    playbooks: createIntegrationsNavigatorPlaybooks(),
    decisions: createIntegrationsNavigatorDecisionDeck(),
    escalationMoments: createIntegrationsNavigatorEscalationMoments()
  };
}

export function createIntegrationsNavigatorReadinessBoard(snapshot = buildIntegrationsNavigatorSnapshot()) {
  return [
    { id: 'integrations-navigator-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'integrations-navigator-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'integrations-navigator-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'integrations-navigator-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createIntegrationsNavigatorApiDocument(snapshot = buildIntegrationsNavigatorSnapshot()) {
  return {
    id: 'integrations-navigator-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/integrations-navigator/overview' },
      { method: 'GET', path: '/api/integrations-navigator/reporting' },
      { method: 'POST', path: '/api/integrations-navigator/validate' },
      { method: 'GET', path: '/api/integrations-navigator/audit' }
    ],
    readiness: createIntegrationsNavigatorReadinessBoard(snapshot)
  };
}

export function createIntegrationsNavigatorRouteSummary(snapshot = buildIntegrationsNavigatorSnapshot()) {
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

