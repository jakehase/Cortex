import { createContentLibraryBrief, validateContentLibraryPlan } from '../domain-content-library.mjs';

export function createContentLibraryApiRoutes(basePath = '/api/content-library') {
  const sample = createContentLibraryBrief();
  return [
    { id: 'content-library.brief', method: 'POST', path: basePath + '/brief', sample },
    { id: 'content-library.validate', method: 'POST', path: basePath + '/validate', validation: validateContentLibraryPlan(sample) }
  ];
}
