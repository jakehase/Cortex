import { createIntegrationsDossierWorkspace, summarizeIntegrationsDossierWorkspace, createIntegrationsDossierNarratives, createIntegrationsDossierCoverageGrid } from './domain-integrations-dossier.mjs';
import { createIntegrationsDossierPolicies, validateIntegrationsDossierPolicies, summarizeIntegrationsDossierPolicies, createIntegrationsDossierEscalationDeck } from './policies-integrations-dossier.mjs';
import { createIntegrationsDossierAnalyticsTimeline, createIntegrationsDossierForecastEnvelope, createIntegrationsDossierExceptionLedger, summarizeIntegrationsDossierAnalytics } from './analytics-integrations-dossier.mjs';
import { createIntegrationsDossierOperationsBoard, createIntegrationsDossierShiftChecklist, createIntegrationsDossierIncidentDeck } from './operations-integrations-dossier.mjs';
import { createIntegrationsDossierReportCards, createIntegrationsDossierReviewPackets, summarizeIntegrationsDossierReporting } from './reporting-integrations-dossier.mjs';
import { createIntegrationsDossierAuditTrail, createIntegrationsDossierEvidenceManifest, createIntegrationsDossierReadinessAttestation } from './audit-integrations-dossier.mjs';
import { createIntegrationsDossierPlaybooks, createIntegrationsDossierDecisionDeck, createIntegrationsDossierEscalationMoments } from './playbooks-integrations-dossier.mjs';

export function buildIntegrationsDossierSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createIntegrationsDossierWorkspace(workspaceName);
  const policies = createIntegrationsDossierPolicies();
  return {
    workspace,
    summary: summarizeIntegrationsDossierWorkspace(workspace),
    narratives: createIntegrationsDossierNarratives(workspace),
    coverage: createIntegrationsDossierCoverageGrid(workspace),
    policies,
    policySummary: summarizeIntegrationsDossierPolicies(policies),
    validation: validateIntegrationsDossierPolicies(policies),
    escalationDeck: createIntegrationsDossierEscalationDeck(policies),
    analytics: {
      timeline: createIntegrationsDossierAnalyticsTimeline(),
      forecast: createIntegrationsDossierForecastEnvelope(),
      exceptions: createIntegrationsDossierExceptionLedger(),
      summary: summarizeIntegrationsDossierAnalytics()
    },
    operations: {
      board: createIntegrationsDossierOperationsBoard(),
      checklist: createIntegrationsDossierShiftChecklist(),
      incidents: createIntegrationsDossierIncidentDeck()
    },
    reporting: {
      cards: createIntegrationsDossierReportCards(),
      packets: createIntegrationsDossierReviewPackets(),
      summary: summarizeIntegrationsDossierReporting()
    },
    audit: {
      trail: createIntegrationsDossierAuditTrail(),
      manifest: createIntegrationsDossierEvidenceManifest(),
      attestation: createIntegrationsDossierReadinessAttestation()
    },
    playbooks: createIntegrationsDossierPlaybooks(),
    decisions: createIntegrationsDossierDecisionDeck(),
    escalationMoments: createIntegrationsDossierEscalationMoments()
  };
}

export function createIntegrationsDossierReadinessBoard(snapshot = buildIntegrationsDossierSnapshot()) {
  return [
    { id: 'integrations-dossier-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'integrations-dossier-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'integrations-dossier-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'integrations-dossier-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createIntegrationsDossierApiDocument(snapshot = buildIntegrationsDossierSnapshot()) {
  return {
    id: 'integrations-dossier-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/integrations-dossier/overview' },
      { method: 'GET', path: '/api/integrations-dossier/reporting' },
      { method: 'POST', path: '/api/integrations-dossier/validate' },
      { method: 'GET', path: '/api/integrations-dossier/audit' }
    ],
    readiness: createIntegrationsDossierReadinessBoard(snapshot)
  };
}

export function createIntegrationsDossierRouteSummary(snapshot = buildIntegrationsDossierSnapshot()) {
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

