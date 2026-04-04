import { createEcommerceCockpitWorkspace, summarizeEcommerceCockpitWorkspace, createEcommerceCockpitNarratives, createEcommerceCockpitCoverageGrid } from './domain-ecommerce-cockpit.mjs';
import { createEcommerceCockpitPolicies, validateEcommerceCockpitPolicies, summarizeEcommerceCockpitPolicies, createEcommerceCockpitEscalationDeck } from './policies-ecommerce-cockpit.mjs';
import { createEcommerceCockpitAnalyticsTimeline, createEcommerceCockpitForecastEnvelope, createEcommerceCockpitExceptionLedger, summarizeEcommerceCockpitAnalytics } from './analytics-ecommerce-cockpit.mjs';
import { createEcommerceCockpitOperationsBoard, createEcommerceCockpitShiftChecklist, createEcommerceCockpitIncidentDeck } from './operations-ecommerce-cockpit.mjs';
import { createEcommerceCockpitReportCards, createEcommerceCockpitReviewPackets, summarizeEcommerceCockpitReporting } from './reporting-ecommerce-cockpit.mjs';
import { createEcommerceCockpitAuditTrail, createEcommerceCockpitEvidenceManifest, createEcommerceCockpitReadinessAttestation } from './audit-ecommerce-cockpit.mjs';
import { createEcommerceCockpitPlaybooks, createEcommerceCockpitDecisionDeck, createEcommerceCockpitEscalationMoments } from './playbooks-ecommerce-cockpit.mjs';

export function buildEcommerceCockpitSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createEcommerceCockpitWorkspace(workspaceName);
  const policies = createEcommerceCockpitPolicies();
  return {
    workspace,
    summary: summarizeEcommerceCockpitWorkspace(workspace),
    narratives: createEcommerceCockpitNarratives(workspace),
    coverage: createEcommerceCockpitCoverageGrid(workspace),
    policies,
    policySummary: summarizeEcommerceCockpitPolicies(policies),
    validation: validateEcommerceCockpitPolicies(policies),
    escalationDeck: createEcommerceCockpitEscalationDeck(policies),
    analytics: {
      timeline: createEcommerceCockpitAnalyticsTimeline(),
      forecast: createEcommerceCockpitForecastEnvelope(),
      exceptions: createEcommerceCockpitExceptionLedger(),
      summary: summarizeEcommerceCockpitAnalytics()
    },
    operations: {
      board: createEcommerceCockpitOperationsBoard(),
      checklist: createEcommerceCockpitShiftChecklist(),
      incidents: createEcommerceCockpitIncidentDeck()
    },
    reporting: {
      cards: createEcommerceCockpitReportCards(),
      packets: createEcommerceCockpitReviewPackets(),
      summary: summarizeEcommerceCockpitReporting()
    },
    audit: {
      trail: createEcommerceCockpitAuditTrail(),
      manifest: createEcommerceCockpitEvidenceManifest(),
      attestation: createEcommerceCockpitReadinessAttestation()
    },
    playbooks: createEcommerceCockpitPlaybooks(),
    decisions: createEcommerceCockpitDecisionDeck(),
    escalationMoments: createEcommerceCockpitEscalationMoments()
  };
}

export function createEcommerceCockpitReadinessBoard(snapshot = buildEcommerceCockpitSnapshot()) {
  return [
    { id: 'ecommerce-cockpit-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'ecommerce-cockpit-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'ecommerce-cockpit-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'ecommerce-cockpit-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createEcommerceCockpitApiDocument(snapshot = buildEcommerceCockpitSnapshot()) {
  return {
    id: 'ecommerce-cockpit-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/ecommerce-cockpit/overview' },
      { method: 'GET', path: '/api/ecommerce-cockpit/reporting' },
      { method: 'POST', path: '/api/ecommerce-cockpit/validate' },
      { method: 'GET', path: '/api/ecommerce-cockpit/audit' }
    ],
    readiness: createEcommerceCockpitReadinessBoard(snapshot)
  };
}

export function createEcommerceCockpitRouteSummary(snapshot = buildEcommerceCockpitSnapshot()) {
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

