import { registerWebsiteBuilderRoutes } from './website-builder.mjs';

export function registerWebsiteRoutes(router, deps) {
  registerWebsiteBuilderRoutes(router, deps);
}
