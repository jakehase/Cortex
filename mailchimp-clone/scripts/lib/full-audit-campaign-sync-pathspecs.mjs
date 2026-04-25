export const DEFAULT_SYNC_EXCLUDES = ['artifacts', 'node_modules'];
export const DEFAULT_PRODUCT_SYNC_INCLUDES = ['apps', 'packages', 'public', 'src'];

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'"'"'`)}'`;
}

export function buildRepoWideSyncPathspecs({ excludes = DEFAULT_SYNC_EXCLUDES } = {}) {
  return ['.', ...excludes.map((entry) => `:(exclude)${entry}`)];
}

export function buildProductSurfaceSyncPathspecs({
  includes = DEFAULT_PRODUCT_SYNC_INCLUDES,
  excludes = DEFAULT_SYNC_EXCLUDES
} = {}) {
  return [
    ...includes,
    ...excludes.map((entry) => `:(exclude)${entry}`),
    ':(exclude)scripts',
    ':(exclude)tests',
    ':(exclude)docs'
  ];
}

export function renderPathspecArgs(pathspecs = []) {
  return pathspecs.map((entry) => shellQuote(entry)).join(' ');
}

export function parsePorcelainStatus(text = '') {
  return String(text)
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .map((line) => {
      const match = /^(..)(?:\s+)(.*)$/.exec(line);
      if (!match) return null;
      const [, rawStatus, rawPayload] = match;
      const payload = rawPayload.trim();
      if (!payload) return null;
      if (rawStatus.includes('R') || rawStatus.includes('C')) {
        const [fromPath, toPath] = payload.split(/\s+->\s+/);
        return {
          status: rawStatus.trim() || rawStatus,
          path: (toPath || payload).trim(),
          fromPath: fromPath?.trim() || null
        };
      }
      return {
        status: rawStatus.trim() || rawStatus,
        path: payload,
        fromPath: null
      };
    })
    .filter(Boolean);
}

export function statusRepresentsDeletion(status = '') {
  return String(status).includes('D');
}
