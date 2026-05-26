export const DEFAULT_SYNC_EXCLUDES = [
  'artifacts',
  'node_modules',
  'packages/app/full-clone-frontier',
  'packages/app/full-clone-remediation',
  'packages/app/full-clone-structural',
  'packages/app/full-clone-swarm',
  ':(exclude,glob)**/*.rej'
];
export const DEFAULT_PRODUCT_SYNC_INCLUDES = ['apps', 'packages', 'public', 'src'];
export const DEFAULT_CONTROL_PLANE_OVERLAY_EXCLUDES = [
  ...DEFAULT_SYNC_EXCLUDES,
  'apps',
  'packages',
  'public',
  'src'
];

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'"'"'`)}'`;
}

function renderExcludePathspec(entry) {
  return String(entry).startsWith(':(') ? entry : `:(exclude)${entry}`;
}

export function buildRepoWideSyncPathspecs({ excludes = DEFAULT_SYNC_EXCLUDES } = {}) {
  return ['.', ...excludes.map((entry) => renderExcludePathspec(entry))];
}

export function buildControlPlaneOverlaySyncPathspecs({ excludes = DEFAULT_CONTROL_PLANE_OVERLAY_EXCLUDES } = {}) {
  return ['.', ...excludes.map((entry) => renderExcludePathspec(entry))];
}

export function buildProductSurfaceSyncPathspecs({
  includes = DEFAULT_PRODUCT_SYNC_INCLUDES,
  excludes = DEFAULT_SYNC_EXCLUDES
} = {}) {
  return [
    ...includes,
    ...excludes.map((entry) => renderExcludePathspec(entry)),
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

export function dirtyEntryAllowedByOverlay(entry, allowedPaths = new Set()) {
  if (!entry || !entry.path) return false;
  const allowed = allowedPaths instanceof Set ? allowedPaths : new Set(allowedPaths || []);
  const candidates = [entry.path, entry.fromPath].filter(Boolean);
  if (candidates.some((candidate) => allowed.has(candidate))) return true;

  // Git collapses an untracked directory to a single `?? path/` porcelain row.
  // Remote continuation worktrees can legitimately receive copied canonical
  // product modules from baseline_overlay.json, including newly-created swarm
  // module directories. Treat that collapsed directory as allowed only when the
  // overlay manifest explicitly names at least one descendant. This keeps the
  // clean-workspace guard strict for arbitrary dirty files while avoiding a
  // false preflight failure before the implementer can process planned leaves.
  if (String(entry.status || '').trim() !== '??') return false;
  for (const candidate of candidates) {
    const prefix = String(candidate).endsWith('/') ? String(candidate) : `${candidate}/`;
    for (const allowedPath of allowed) {
      if (String(allowedPath).startsWith(prefix)) return true;
    }
  }
  return false;
}

export function statusRepresentsDeletion(status = '') {
  return String(status).includes('D');
}
