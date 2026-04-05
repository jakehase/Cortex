import crypto from 'node:crypto';

const PASSWORD_SCHEME = 'pbkdf2_sha256';
const PASSWORD_ITERATIONS = 20000;
const PASSWORD_KEY_LENGTH = 32;

export function nowIso() {
  return new Date().toISOString();
}

export function createId(prefix) {
  return `${prefix}_${crypto.randomBytes(6).toString('hex')}`;
}

export function sha256(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.pbkdf2Sync(String(password || ''), salt, PASSWORD_ITERATIONS, PASSWORD_KEY_LENGTH, 'sha256').toString('hex');
  return `${PASSWORD_SCHEME}$${PASSWORD_ITERATIONS}$${salt}$${derived}`;
}

function legacyHashPassword(password) {
  return sha256(password);
}

export function verifyPassword(password, storedHash = '') {
  const value = String(storedHash || '');
  if (!value) return false;
  if (!value.startsWith(`${PASSWORD_SCHEME}$`)) return legacyHashPassword(password) === value;
  const [, iterationsText, salt, expected] = value.split('$');
  const iterations = Number(iterationsText);
  if (!iterations || !salt || !expected) return false;
  const actual = crypto.pbkdf2Sync(String(password || ''), salt, iterations, Buffer.from(expected, 'hex').length, 'sha256').toString('hex');
  return crypto.timingSafeEqual(Buffer.from(actual, 'hex'), Buffer.from(expected, 'hex'));
}

export function passwordHashNeedsUpgrade(storedHash = '') {
  return !String(storedHash || '').startsWith(`${PASSWORD_SCHEME}$`);
}

export function escapeHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

export function csvSplit(value = '') {
  return String(value)
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
}

export function parseCookies(req) {
  const header = req.headers.cookie || '';
  return Object.fromEntries(
    header
      .split(';')
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const idx = part.indexOf('=');
        return idx === -1 ? [part, ''] : [part.slice(0, idx), decodeURIComponent(part.slice(idx + 1))];
      })
  );
}

function parseForm(text) {
  const params = new URLSearchParams(text);
  const out = {};
  for (const [key, value] of params.entries()) {
    if (key in out) out[key] = Array.isArray(out[key]) ? [...out[key], value] : [out[key], value];
    else out[key] = value;
  }
  return out;
}

export async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString('utf8');
  const type = req.headers['content-type'] || '';
  if (type.includes('application/json')) return JSON.parse(text || '{}');
  if (type.includes('application/x-www-form-urlencoded')) return parseForm(text);
  return { raw: text };
}

export function formArray(body, key) {
  const value = body[key];
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null || value === '') return [];
  return [value];
}

export function normalizeDomainName(value = '') {
  return String(value || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/$/, '');
}

export function text(res, status, body, headers = {}) {
  res.writeHead(status, { 'content-type': 'text/html; charset=utf-8', ...headers });
  res.end(body);
}

export function json(res, status, body, headers = {}) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', ...headers });
  res.end(JSON.stringify(body, null, 2));
}

export function redirect(res, location, headers = {}) {
  res.writeHead(302, { location, ...headers });
  res.end();
}

export function csv(res, filename, body) {
  res.writeHead(200, {
    'content-type': 'text/csv; charset=utf-8',
    'content-disposition': `attachment; filename="${filename}"`
  });
  res.end(body);
}
