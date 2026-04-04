import { buildDeliverabilityLabsSnapshot } from '../service-deliverability-labs.mjs';

export function createDeliverabilityLabsDashboardRoutes(basePath = '/deliverability-labs') { const snapshot = buildDeliverabilityLabsSnapshot(); return [{ id: 'deliverability-labs.overview', method: 'GET', path: basePath, summary: snapshot.summary }, { id: 'deliverability-labs.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs }, { id: 'deliverability-labs.narratives', method: 'GET', path: basePath + '/narratives', narratives: snapshot.narratives }]; }
