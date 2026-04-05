import { createExperimentationDossierWorkspace, summarizeExperimentationDossierWorkspace, createExperimentationDossierNarratives, createExperimentationDossierCoverageGrid } from './domain-experimentation-dossier.mjs';
import { createExperimentationDossierPolicies, validateExperimentationDossierPolicies, summarizeExperimentationDossierPolicies, createExperimentationDossierEscalationDeck } from './policies-experimentation-dossier.mjs';
import { createExperimentationDossierAnalyticsTimeline, createExperimentationDossierForecastEnvelope, createExperimentationDossierExceptionLedger, summarizeExperimentationDossierAnalytics } from './analytics-experimentation-dossier.mjs';
import { createExperimentationDossierOperationsBoard, createExperimentationDossierShiftChecklist, createExperimentationDossierIncidentDeck } from './operations-experimentation-dossier.mjs';
import { createExperimentationDossierReportCards, createExperimentationDossierReviewPackets, summarizeExperimentationDossierReporting } from './reporting-experimentation-dossier.mjs';
import { createExperimentationDossierAuditTrail, createExperimentationDossierEvidenceManifest, createExperimentationDossierReadinessAttestation } from './audit-experimentation-dossier.mjs';
import { createExperimentationDossierPlaybooks, createExperimentationDossierDecisionDeck, createExperimentationDossierEscalationMoments } from './playbooks-experimentation-dossier.mjs';

export function buildExperimentationDossierSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createExperimentationDossierWorkspace(workspaceName);
  const policies = createExperimentationDossierPolicies();
  return {
    workspace,
    summary: summarizeExperimentationDossierWorkspace(workspace),
    narratives: createExperimentationDossierNarratives(workspace),
    coverage: createExperimentationDossierCoverageGrid(workspace),
    policies,
    policySummary: summarizeExperimentationDossierPolicies(policies),
    validation: validateExperimentationDossierPolicies(policies),
    escalationDeck: createExperimentationDossierEscalationDeck(policies),
    analytics: {
      timeline: createExperimentationDossierAnalyticsTimeline(),
      forecast: createExperimentationDossierForecastEnvelope(),
      exceptions: createExperimentationDossierExceptionLedger(),
      summary: summarizeExperimentationDossierAnalytics()
    },
    operations: {
      board: createExperimentationDossierOperationsBoard(),
      checklist: createExperimentationDossierShiftChecklist(),
      incidents: createExperimentationDossierIncidentDeck()
    },
    reporting: {
      cards: createExperimentationDossierReportCards(),
      packets: createExperimentationDossierReviewPackets(),
      summary: summarizeExperimentationDossierReporting()
    },
    audit: {
      trail: createExperimentationDossierAuditTrail(),
      manifest: createExperimentationDossierEvidenceManifest(),
      attestation: createExperimentationDossierReadinessAttestation()
    },
    playbooks: createExperimentationDossierPlaybooks(),
    decisions: createExperimentationDossierDecisionDeck(),
    escalationMoments: createExperimentationDossierEscalationMoments()
  };
}

export function createExperimentationDossierReadinessBoard(snapshot = buildExperimentationDossierSnapshot()) {
  return [
    { id: 'experimentation-dossier-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'experimentation-dossier-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'experimentation-dossier-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'experimentation-dossier-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createExperimentationDossierApiDocument(snapshot = buildExperimentationDossierSnapshot()) {
  return {
    id: 'experimentation-dossier-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/experimentation-dossier/overview' },
      { method: 'GET', path: '/api/experimentation-dossier/reporting' },
      { method: 'POST', path: '/api/experimentation-dossier/validate' },
      { method: 'GET', path: '/api/experimentation-dossier/audit' }
    ],
    readiness: createExperimentationDossierReadinessBoard(snapshot)
  };
}

export function createExperimentationDossierRouteSummary(snapshot = buildExperimentationDossierSnapshot()) {
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

