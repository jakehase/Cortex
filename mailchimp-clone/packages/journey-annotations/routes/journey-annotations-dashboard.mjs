import { buildJourneyAnnotationsSnapshot } from '../service-journey-annotations.mjs';

export function createJourneyAnnotationsDashboardRoutes(basePath='/journey-annotations'){const snapshot=buildJourneyAnnotationsSnapshot(); return [{id:'journey-annotations.overview',method:'GET',path:basePath,summary:snapshot.summary},{id:'journey-annotations.programs',method:'GET',path:basePath+'/programs',programs:snapshot.workspace.programs},{id:'journey-annotations.narratives',method:'GET',path:basePath+'/narratives',narratives:snapshot.narratives}];}
