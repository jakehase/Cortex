import { createCustomerAtlasWorkspace, summarizeCustomerAtlasWorkspace, createCustomerAtlasNarratives, createCustomerAtlasCoverageGrid } from './domain-customer-atlas.mjs';
import { createCustomerAtlasPolicies, validateCustomerAtlasPolicies, summarizeCustomerAtlasPolicies, createCustomerAtlasEscalationDeck } from './policies-customer-atlas.mjs';
import { createCustomerAtlasAnalyticsTimeline, createCustomerAtlasForecastEnvelope, createCustomerAtlasExceptionLedger, summarizeCustomerAtlasAnalytics } from './analytics-customer-atlas.mjs';
import { createCustomerAtlasOperationsBoard, createCustomerAtlasShiftChecklist, createCustomerAtlasIncidentDeck } from './operations-customer-atlas.mjs';
import { createCustomerAtlasReportCards, createCustomerAtlasReviewPackets, summarizeCustomerAtlasReporting } from './reporting-customer-atlas.mjs';
import { createCustomerAtlasAuditTrail, createCustomerAtlasEvidenceManifest, createCustomerAtlasReadinessAttestation } from './audit-customer-atlas.mjs';
import { createCustomerAtlasPlaybooks, createCustomerAtlasDecisionDeck, createCustomerAtlasEscalationMoments } from './playbooks-customer-atlas.mjs';

export function buildCustomerAtlasSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createCustomerAtlasWorkspace(workspaceName);
  const policies = createCustomerAtlasPolicies();
  return {
    workspace,
    summary: summarizeCustomerAtlasWorkspace(workspace),
    narratives: createCustomerAtlasNarratives(workspace),
    coverage: createCustomerAtlasCoverageGrid(workspace),
    policies,
    policySummary: summarizeCustomerAtlasPolicies(policies),
    validation: validateCustomerAtlasPolicies(policies),
    escalationDeck: createCustomerAtlasEscalationDeck(policies),
    analytics: {
      timeline: createCustomerAtlasAnalyticsTimeline(),
      forecast: createCustomerAtlasForecastEnvelope(),
      exceptions: createCustomerAtlasExceptionLedger(),
      summary: summarizeCustomerAtlasAnalytics()
    },
    operations: {
      board: createCustomerAtlasOperationsBoard(),
      checklist: createCustomerAtlasShiftChecklist(),
      incidents: createCustomerAtlasIncidentDeck()
    },
    reporting: {
      cards: createCustomerAtlasReportCards(),
      packets: createCustomerAtlasReviewPackets(),
      summary: summarizeCustomerAtlasReporting()
    },
    audit: {
      trail: createCustomerAtlasAuditTrail(),
      manifest: createCustomerAtlasEvidenceManifest(),
      attestation: createCustomerAtlasReadinessAttestation()
    },
    playbooks: createCustomerAtlasPlaybooks(),
    decisions: createCustomerAtlasDecisionDeck(),
    escalationMoments: createCustomerAtlasEscalationMoments()
  };
}

export function createCustomerAtlasReadinessBoard(snapshot = buildCustomerAtlasSnapshot()) {
  return [
    { id: 'customer-atlas-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'customer-atlas-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'customer-atlas-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'customer-atlas-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createCustomerAtlasApiDocument(snapshot = buildCustomerAtlasSnapshot()) {
  return {
    id: 'customer-atlas-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/customer-atlas/overview' },
      { method: 'GET', path: '/api/customer-atlas/reporting' },
      { method: 'POST', path: '/api/customer-atlas/validate' },
      { method: 'GET', path: '/api/customer-atlas/audit' }
    ],
    readiness: createCustomerAtlasReadinessBoard(snapshot)
  };
}

export function createCustomerAtlasRouteSummary(snapshot = buildCustomerAtlasSnapshot()) {
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

