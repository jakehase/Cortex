import { buildRetentionScorecardsSnapshot } from '../service-retention-scorecards.mjs';

export function createRetentionScorecardsDashboardRoutes(basePath='/retention-scorecards'){const snapshot=buildRetentionScorecardsSnapshot(); return [{id:'retention-scorecards.overview',method:'GET',path:basePath,summary:snapshot.summary},{id:'retention-scorecards.programs',method:'GET',path:basePath+'/programs',programs:snapshot.workspace.programs},{id:'retention-scorecards.narratives',method:'GET',path:basePath+'/narratives',narratives:snapshot.narratives}];}
