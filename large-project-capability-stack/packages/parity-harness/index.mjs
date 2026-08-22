export class CookieJar {
  constructor() {
    this.cookies = new Map();
  }

  capture(response) {
    const setCookie = response.headers.get('set-cookie');
    if (!setCookie) return;
    const [pair] = setCookie.split(';');
    const [key, value] = pair.split('=');
    this.cookies.set(key, value);
  }

  header() {
    return [...this.cookies.entries()].map(([key, value]) => `${key}=${value}`).join('; ');
  }
}

function fixtureValue(fixtures, pathname) {
  const value = fixtures[pathname];
  if (!value) throw new Error(`Missing fixture for ${pathname}`);
  return value;
}

function normalizeEvidence(target = {}) {
  const base = target.evidence || { mode: target.kind || 'unknown' };
  const browser = base.browser || { available: false, real: false, driver: 'none' };
  const mechanicalDowngrades = [...new Set(base.mechanicalDowngrades || [])];
  if (browser.available && !browser.real) mechanicalDowngrades.push('no_real_browser_proof');
  if (target.kind === 'http') mechanicalDowngrades.push('http_only_evidence');
  if (target.kind === 'fixture') mechanicalDowngrades.push('fixture_only_evidence');
  return {
    mode: base.mode || target.kind || 'unknown',
    browser,
    mechanicalDowngrades,
    targetLabel: base.targetLabel || target.baseUrl || target.kind || 'target'
  };
}

export function createFixtureTarget(fixtures) {
  return {
    kind: 'fixture',
    evidence: {
      mode: 'fixture',
      browser: { available: false, real: false, driver: 'none' },
      mechanicalDowngrades: ['fixture_only_evidence'],
      targetLabel: 'fixture-target'
    },
    async request(pathname) {
      return fixtureValue(fixtures, pathname);
    },
    async getText(pathname) {
      const value = await this.request(pathname);
      return typeof value === 'string' ? value : value.text;
    },
    async getJson(pathname) {
      const value = await this.request(pathname);
      return typeof value === 'object' ? value.json || value : value;
    }
  };
}

export function createHttpTarget({ baseUrl, cookieJar = new CookieJar() }) {
  async function request(pathname, options = {}) {
    const headers = new Headers(options.headers || {});
    if (cookieJar.header()) headers.set('cookie', cookieJar.header());
    const response = await fetch(`${baseUrl}${pathname}`, { redirect: 'manual', ...options, headers });
    cookieJar.capture(response);
    return response;
  }
  return {
    kind: 'http',
    baseUrl,
    cookieJar,
    evidence: {
      mode: 'http',
      browser: { available: false, real: false, driver: 'none' },
      mechanicalDowngrades: ['http_only_evidence'],
      targetLabel: baseUrl
    },
    request,
    async getText(pathname, options = {}) {
      return (await request(pathname, options)).text();
    },
    async getJson(pathname, options = {}) {
      return (await request(pathname, options)).json();
    },
    async postForm(pathname, form) {
      return request(pathname, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(form)
      });
    },
    async followRedirect(response) {
      const location = response.headers.get('location');
      if (!location) throw new Error('Missing redirect location');
      return request(location);
    }
  };
}

export function createSimulatedBrowserDriver(fixtures) {
  return {
    async getText(pathname) {
      const value = fixtureValue(fixtures, pathname);
      return typeof value === 'string' ? value : value.text;
    },
    async getJson(pathname) {
      const value = fixtureValue(fixtures, pathname);
      return typeof value === 'object' ? value.json || value : value;
    },
    async postForm(pathname, form) {
      if (typeof fixtures.__postForm === 'function') return fixtures.__postForm(pathname, form);
      return fixtureValue(fixtures, pathname);
    }
  };
}

export function createBrowserAdapterTarget({
  driver,
  browserName = 'adapter',
  realBrowser = false,
  targetLabel = browserName,
  mechanicalDowngrades = realBrowser ? [] : ['simulated_browser_adapter']
}) {
  if (!driver) throw new Error('driver is required');
  return {
    kind: 'browser_adapter',
    evidence: {
      mode: 'browser_adapter',
      browser: { available: true, real: realBrowser, driver: browserName },
      mechanicalDowngrades,
      targetLabel
    },
    async request(pathname, options = {}) {
      if (typeof driver.request !== 'function') throw new Error('driver.request is not implemented');
      return driver.request(pathname, options);
    },
    async getText(pathname, options = {}) {
      if (typeof driver.getText === 'function') return driver.getText(pathname, options);
      if (typeof driver.renderText === 'function') return driver.renderText(pathname, options);
      throw new Error('driver.getText/renderText is not implemented');
    },
    async getJson(pathname, options = {}) {
      if (typeof driver.getJson !== 'function') throw new Error('driver.getJson is not implemented');
      return driver.getJson(pathname, options);
    },
    async postForm(pathname, form) {
      if (typeof driver.postForm !== 'function') throw new Error('driver.postForm is not implemented');
      return driver.postForm(pathname, form);
    },
    async followRedirect(response) {
      if (typeof driver.followRedirect !== 'function') throw new Error('driver.followRedirect is not implemented');
      return driver.followRedirect(response);
    }
  };
}

export async function runParityHarness({ target, checks, context = {} }) {
  const results = [];
  const evidence = normalizeEvidence(target);
  for (const check of checks) {
    try {
      let details;
      if (check.run) {
        details = await check.run(target, context);
      } else if (check.type === 'text' || check.type === 'browser_text') {
        const text = await target.getText(check.path, check.options || {});
        if (!text.includes(check.expect)) throw new Error(`Expected text to include ${check.expect}`);
        details = { path: check.path, expect: check.expect };
      } else if (check.type === 'json') {
        const payload = await target.getJson(check.path, check.options || {});
        const actual = check.select ? check.select(payload) : payload;
        if (JSON.stringify(actual) !== JSON.stringify(check.expect)) throw new Error(`Expected ${JSON.stringify(check.expect)} but saw ${JSON.stringify(actual)}`);
        details = { path: check.path, actual };
      } else {
        throw new Error(`Unsupported check type ${check.type}`);
      }
      results.push({ id: check.id, ok: true, details });
    } catch (error) {
      results.push({ id: check.id, ok: false, error: String(error.message || error) });
    }
  }
  return {
    generatedAt: new Date().toISOString(),
    ok: results.every((entry) => entry.ok),
    total: results.length,
    passed: results.filter((entry) => entry.ok).length,
    failed: results.filter((entry) => !entry.ok).length,
    evidence,
    checks: results
  };
}
