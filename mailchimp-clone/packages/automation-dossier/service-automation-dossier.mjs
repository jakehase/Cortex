import { createAutomationDossierWorkspace, summarizeAutomationDossierWorkspace, createAutomationDossierNarratives, createAutomationDossierCoverageGrid } from './domain-automation-dossier.mjs';
import { createAutomationDossierPolicies, validateAutomationDossierPolicies, summarizeAutomationDossierPolicies, createAutomationDossierEscalationDeck } from './policies-automation-dossier.mjs';
import { createAutomationDossierAnalyticsTimeline, createAutomationDossierForecastEnvelope, createAutomationDossierExceptionLedger, summarizeAutomationDossierAnalytics } from './analytics-automation-dossier.mjs';
import { createAutomationDossierOperationsBoard, createAutomationDossierShiftChecklist, createAutomationDossierIncidentDeck } from './operations-automation-dossier.mjs';
import { createAutomationDossierReportCards, createAutomationDossierReviewPackets, summarizeAutomationDossierReporting } from './reporting-automation-dossier.mjs';
import { createAutomationDossierAuditTrail, createAutomationDossierEvidenceManifest, createAutomationDossierReadinessAttestation } from './audit-automation-dossier.mjs';
import { createAutomationDossierPlaybooks, createAutomationDossierDecisionDeck, createAutomationDossierEscalationMoments } from './playbooks-automation-dossier.mjs';

export function buildAutomationDossierSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createAutomationDossierWorkspace(workspaceName);
  const policies = createAutomationDossierPolicies();
  return {
    workspace,
    summary: summarizeAutomationDossierWorkspace(workspace),
    narratives: createAutomationDossierNarratives(workspace),
    coverage: createAutomationDossierCoverageGrid(workspace),
    policies,
    policySummary: summarizeAutomationDossierPolicies(policies),
    validation: validateAutomationDossierPolicies(policies),
    escalationDeck: createAutomationDossierEscalationDeck(policies),
    analytics: {
      timeline: createAutomationDossierAnalyticsTimeline(),
      forecast: createAutomationDossierForecastEnvelope(),
      exceptions: createAutomationDossierExceptionLedger(),
      summary: summarizeAutomationDossierAnalytics()
    },
    operations: {
      board: createAutomationDossierOperationsBoard(),
      checklist: createAutomationDossierShiftChecklist(),
      incidents: createAutomationDossierIncidentDeck()
    },
    reporting: {
      cards: createAutomationDossierReportCards(),
      packets: createAutomationDossierReviewPackets(),
      summary: summarizeAutomationDossierReporting()
    },
    audit: {
      trail: createAutomationDossierAuditTrail(),
      manifest: createAutomationDossierEvidenceManifest(),
      attestation: createAutomationDossierReadinessAttestation()
    },
    playbooks: createAutomationDossierPlaybooks(),
    decisions: createAutomationDossierDecisionDeck(),
    escalationMoments: createAutomationDossierEscalationMoments()
  };
}

export function createAutomationDossierReadinessBoard(snapshot = buildAutomationDossierSnapshot()) {
  return [
    { id: 'automation-dossier-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'automation-dossier-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'automation-dossier-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'automation-dossier-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createAutomationDossierApiDocument(snapshot = buildAutomationDossierSnapshot()) {
  return {
    id: 'automation-dossier-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/automation-dossier/overview' },
      { method: 'GET', path: '/api/automation-dossier/reporting' },
      { method: 'POST', path: '/api/automation-dossier/validate' },
      { method: 'GET', path: '/api/automation-dossier/audit' }
    ],
    readiness: createAutomationDossierReadinessBoard(snapshot)
  };
}

export function createAutomationDossierRouteSummary(snapshot = buildAutomationDossierSnapshot()) {
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

