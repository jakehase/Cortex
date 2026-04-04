export function createRouter() {
  const routes = [];

  function match(pattern, pathname) {
    const a = pattern.split('/').filter(Boolean);
    const b = pathname.split('/').filter(Boolean);
    if (a.length !== b.length) return null;
    const params = {};
    for (let i = 0; i < a.length; i += 1) {
      if (a[i].startsWith(':')) params[a[i].slice(1)] = decodeURIComponent(b[i]);
      else if (a[i] !== b[i]) return null;
    }
    return params;
  }

  return {
    register(method, pattern, handler) {
      routes.push({ method: method.toUpperCase(), pattern, handler });
    },
    async handle(ctx) {
      for (const route of routes) {
        if (route.method !== ctx.req.method.toUpperCase()) continue;
        const params = match(route.pattern, ctx.url.pathname);
        if (!params) continue;
        await route.handler({ ...ctx, params });
        return true;
      }
      return false;
    }
  };
}
