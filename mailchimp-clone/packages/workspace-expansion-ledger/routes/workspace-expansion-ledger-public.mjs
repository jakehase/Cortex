import { buildWorkspaceExpansionLedgerSnapshot } from '../service-workspace-expansion-ledger.mjs';
import { createWorkspaceExpansionLedgerFixtures } from '../fixtures-workspace-expansion-ledger.mjs';

export function createWorkspaceExpansionLedgerPublicRoutes(basePath='/public/workspace-expansion-ledger'){const snapshot=buildWorkspaceExpansionLedgerSnapshot(); const fixtures=createWorkspaceExpansionLedgerFixtures(); return [{id:'workspace-expansion-ledger.public.summary',method:'GET',path:basePath,focus:snapshot.summary.focus},{id:'workspace-expansion-ledger.public.catalog',method:'GET',path:basePath+'/catalog',contacts:fixtures.contacts},{id:'workspace-expansion-ledger.public.notes',method:'GET',path:basePath+'/notes',notes:fixtures.notes}];}
