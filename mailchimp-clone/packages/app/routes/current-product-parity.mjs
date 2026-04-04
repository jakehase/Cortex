import { registerWebsiteBuilderRoutes } from './website-builder.mjs';
import { registerCurrentProductOpsRoutes } from './current-product-ops.mjs';

export function registerCurrentProductParityRoutes(router, deps) {
  registerWebsiteBuilderRoutes(router, deps);
  registerCurrentProductOpsRoutes(router, deps);
}
