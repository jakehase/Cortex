#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA_DIR = path.join(ROOT, 'data');
const USER_AGENT = 'CatalystRadarPilot/0.1 (+public-source-monitoring; no-trading)';

const KEYWORD_GROUPS = [
  {
    id: 'courts_legal',
    label: 'Courts / lawsuits',
    weight: 7,
    terms: ['court', 'lawsuit', 'injunction', 'appeal', 'judge', 'supreme court', 'scotus', 'trial', 'charges', 'indictment', 'arrested', 'sentenced', 'custody', 'impeached', 'federally charged']
  },
  {
    id: 'agency_regulatory',
    label: 'Agency / regulatory action',
    weight: 7,
    terms: ['sec', 'fda', 'ftc', 'doj', 'cftc', 'fcc', 'epa', 'regulator', 'regulatory', 'enforcement action', 'agency approval']
  },
  {
    id: 'rulemaking_register',
    label: 'Rulemaking / Federal Register',
    weight: 6,
    terms: ['federal register', 'rulemaking', 'notice of proposed rulemaking', 'comment period', 'final rule', 'proposed rule']
  },
  {
    id: 'legislation',
    label: 'Legislation / committees',
    weight: 5,
    terms: ['bill', 'senate', 'house', 'congress', 'committee', 'veto', 'legislation', 'parliament']
  },
  {
    id: 'company_filings',
    label: 'Company filings / corporate actions',
    weight: 4,
    terms: ['ipo', 'merger', 'acquisition', 'bankruptcy', 'chapter 11', 'edgar', 'filing', '10-k', '8-k', 's-1']
  },
  {
    id: 'health_products',
    label: 'FDA / health products',
    weight: 6,
    terms: ['drug', 'vaccine', 'fda', 'pdufa', 'advisory committee', 'clinical trial']
  }
];

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

async function fetchJson(url) {
  const res = await fetch(url, { headers: { 'accept': 'application/json', 'user-agent': USER_AGENT } });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  return res.json();
}

function normalizeText(value) {
  return String(value || '').toLowerCase().replace(/\s+/g, ' ');
}

function number(value, fallback = 0) {
  const n = Number(String(value ?? '').replace(/,/g, ''));
  return Number.isFinite(n) ? n : fallback;
}

function dateValue(value) {
  const ms = Date.parse(value || '');
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

function firstNumber(...values) {
  for (const value of values) {
    const n = number(value, NaN);
    if (Number.isFinite(n)) return n;
  }
  return 0;
}

function parsePolymarketPrice(market) {
  const prices = market.outcomePrices || market.outcomesPrices || market.prices;
  if (Array.isArray(prices) && prices.length) return number(prices[0], null);
  if (typeof prices === 'string') {
    try {
      const parsed = JSON.parse(prices);
      if (Array.isArray(parsed) && parsed.length) return number(parsed[0], null);
    } catch {}
  }
  return null;
}

function normalizePolymarket(market) {
  return {
    platform: 'polymarket',
    id: String(market.id || market.conditionId || market.slug || ''),
    ticker: market.slug || market.ticker || String(market.id || ''),
    title: market.question || market.title || '',
    description: market.description || '',
    resolutionSource: market.resolutionSource || '',
    url: market.slug ? `https://polymarket.com/event/${market.slug}` : null,
    closeTime: dateValue(market.endDate || market.endDateIso || market.end_date_iso),
    liquidityUsd: firstNumber(market.liquidity, market.liquidityNum, market.liquidityClob),
    volumeUsd: firstNumber(market.volume, market.volumeNum),
    yesPrice: parsePolymarketPrice(market),
    rawCategory: market.category || market.groupItemTitle || null
  };
}

function normalizeKalshi(market) {
  const yesBid = market.yes_bid_dollars ?? (market.yes_bid != null ? Number(market.yes_bid) / 100 : null);
  const yesAsk = market.yes_ask_dollars ?? (market.yes_ask != null ? Number(market.yes_ask) / 100 : null);
  return {
    platform: 'kalshi',
    id: market.ticker || market.market_ticker || '',
    ticker: market.ticker || market.market_ticker || '',
    title: market.title || market.subtitle || '',
    description: [market.rules_primary, market.rules_secondary, market.settlement_sources, market.result].filter(Boolean).join('\n\n'),
    resolutionSource: market.settlement_sources || market.rules_primary || '',
    url: market.ticker ? `https://kalshi.com/markets/${String(market.ticker).toLowerCase()}` : null,
    closeTime: dateValue(market.close_time || market.expiration_time || market.latest_expiration_time),
    liquidityUsd: firstNumber(market.liquidity_dollars, market.liquidity, market.liquidity_fp),
    volumeUsd: firstNumber(market.volume_dollars, market.volume, market.volume_fp),
    yesPrice: yesBid != null && yesAsk != null ? Number(((Number(yesBid) + Number(yesAsk)) / 2).toFixed(4)) : number(yesBid, null),
    rawCategory: market.category || market.event_ticker || null
  };
}

async function fetchPolymarketMarkets() {
  const batches = [];
  for (const offset of [0, 100, 200, 300, 400, 500, 600, 700, 800, 900]) {
    const url = `https://gamma-api.polymarket.com/markets?closed=false&active=true&limit=100&offset=${offset}`;
    batches.push(fetchJson(url));
  }
  const results = await Promise.allSettled(batches);
  const markets = results.flatMap((result) => result.status === 'fulfilled' && Array.isArray(result.value) ? result.value : []);
  return markets.map(normalizePolymarket);
}

async function fetchKalshiMarkets() {
  const markets = [];
  let cursor = '';
  for (let page = 0; page < 3; page += 1) {
    const url = new URL('https://external-api.kalshi.com/trade-api/v2/markets');
    url.searchParams.set('status', 'open');
    url.searchParams.set('limit', '200');
    if (cursor) url.searchParams.set('cursor', cursor);
    const payload = await fetchJson(url.toString());
    markets.push(...(payload.markets || []));
    cursor = payload.cursor || '';
    if (!cursor) break;
  }
  return markets.map(normalizeKalshi);
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function termMatches(text, term) {
  const escaped = escapeRegex(term).replace(/\\\s\+/g, '\\s+');
  return new RegExp(`(^|[^a-z0-9])${escaped}($|[^a-z0-9])`, 'i').test(text);
}

function matchGroups(candidate) {
  const text = normalizeText([candidate.title, candidate.description, candidate.resolutionSource, candidate.rawCategory].filter(Boolean).join(' | '));
  const groups = [];
  const terms = [];
  for (const group of KEYWORD_GROUPS) {
    const hits = group.terms.filter((term) => termMatches(text, term));
    if (hits.length) {
      groups.push({ id: group.id, label: group.label, hits, weight: group.weight });
      terms.push(...hits);
    }
  }
  return { groups, terms: [...new Set(terms)] };
}

function sourcePlanFor(candidate, groups) {
  const ids = new Set(groups.map((g) => g.id));
  const title = normalizeText(candidate.title);
  const plan = [];
  if (ids.has('courts_legal')) plan.push('CourtListener/RECAP docket search; court opinions/orders pages; party press releases only as secondary evidence.');
  if (ids.has('agency_regulatory') || ids.has('rulemaking_register')) plan.push('Agency press releases/enforcement pages; Federal Register API; relevant agency calendars and notices.');
  if (ids.has('health_products') || /\bfda\b|drug|vaccine|pdufa/.test(title)) plan.push('FDA advisory committee calendar, Drugs@FDA, FDA press announcements, Federal Register notices.');
  if (/\bsec\b|etf|ipo|edgar|filing|s-1|8-k/.test(title) || ids.has('company_filings')) plan.push('SEC EDGAR company filings; SEC releases/litigation/admin proceedings; exchange listing notices if relevant.');
  if (ids.has('legislation')) plan.push('Congress.gov bill status/actions; committee calendars; official chamber roll-call/vote pages.');
  if (!plan.length && candidate.resolutionSource) plan.push(`Start with stated resolution source: ${candidate.resolutionSource.slice(0, 240)}`);
  if (!plan.length) plan.push('Manual source discovery needed before this market is eligible for automated monitoring.');
  return [...new Set(plan)];
}

function scoreCandidate(candidate, match) {
  const groupScore = Math.min(28, match.groups.reduce((sum, group) => sum + group.weight, 0));
  const liquidityScore = Math.min(18, Math.log10(Math.max(1, candidate.liquidityUsd || 0) + 1) * 5);
  const volumeScore = Math.min(14, Math.log10(Math.max(1, candidate.volumeUsd || 0) + 1) * 4);
  const resolutionScore = candidate.resolutionSource ? 12 : candidate.description.length > 300 ? 8 : candidate.description.length > 80 ? 4 : 0;
  const closeMs = Date.parse(candidate.closeTime || '');
  const daysLeft = Number.isFinite(closeMs) ? (closeMs - Date.now()) / 86400000 : null;
  const timeScore = daysLeft == null ? 3 : daysLeft > 2 && daysLeft < 240 ? 10 : daysLeft >= 240 ? 6 : 1;
  const sourcePlan = sourcePlanFor(candidate, match.groups);
  const sourceScore = Math.min(18, sourcePlan.length * 7);
  return {
    score: Math.round(groupScore + liquidityScore + volumeScore + resolutionScore + timeScore + sourceScore),
    daysLeft: daysLeft == null ? null : Number(daysLeft.toFixed(1)),
    sourcePlan
  };
}

function candidateKey(candidate) {
  return `${candidate.platform}:${candidate.id || candidate.ticker || candidate.title}`;
}

function isCoreNiche(match) {
  const core = new Set(['courts_legal', 'agency_regulatory', 'rulemaking_register', 'health_products', 'company_filings']);
  return match.groups.some((group) => core.has(group.id));
}

function isLikelyElectionHorseRace(candidate, match) {
  const title = normalizeText(candidate.title || '');
  const text = normalizeText([candidate.title, candidate.description, candidate.rawCategory].filter(Boolean).join(' | '));
  if (/\bwill .+ win (?:the )?\d{4} .*election\b/.test(title) || /\bpresidential election\b/.test(title)) return true;
  const hasElectionShape = /\b(election|presidential|nominee|candidate|popular vote|electoral college|prime minister)\b/.test(text);
  const hasLitigationSignal = /\b(lawsuit|injunction|judge|appeal|indictment|charges|trial|arrested|sentenced|custody|impeached)\b/.test(text);
  return hasElectionShape && !hasLitigationSignal;
}

function isObviousOffNiche(candidate) {
  const title = normalizeText(candidate.title || '');
  return /\b(approval rating|nobel|peace prize|release a new song|release a new album|album before|song in \d{4})\b/.test(title);
}

function nichePriority(match) {
  const highPriority = new Set(['courts_legal', 'agency_regulatory', 'rulemaking_register', 'health_products']);
  if (match.groups.some((group) => highPriority.has(group.id))) return 2;
  if (match.groups.some((group) => group.id === 'company_filings')) return 1;
  return 0;
}

function rank(markets) {
  const seen = new Set();
  const candidates = [];
  for (const market of markets) {
    const key = candidateKey(market);
    if (seen.has(key)) continue;
    seen.add(key);
    const match = matchGroups(market);
    if (!match.groups.length) continue;
    if (!isCoreNiche(match)) continue;
    if (isLikelyElectionHorseRace(market, match)) continue;
    if (isObviousOffNiche(market)) continue;
    const scored = scoreCandidate(market, match);
    if (scored.daysLeft != null && scored.daysLeft < 0) continue;
    if (scored.score < 35) continue;
    candidates.push({
      ...market,
      score: scored.score,
      nichePriority: nichePriority(match),
      daysLeft: scored.daysLeft,
      matchedTerms: match.terms.slice(0, 18),
      matchedGroups: match.groups.map((g) => ({ id: g.id, label: g.label, hits: g.hits })),
      sourcePlan: scored.sourcePlan,
      evidenceStatus: 'source_plan_only',
      tradingAction: 'none'
    });
  }
  return candidates.sort((a, b) => b.nichePriority - a.nichePriority || b.score - a.score || (b.liquidityUsd + b.volumeUsd) - (a.liquidityUsd + a.volumeUsd));
}

function markdownReport(payload) {
  const lines = [];
  lines.push(`# Catalyst Radar pilot scan`);
  lines.push('');
  lines.push(`Generated: ${payload.generatedAt}`);
  lines.push(`Inputs: ${payload.inputCounts.polymarket} Polymarket + ${payload.inputCounts.kalshi} Kalshi open/public markets`);
  lines.push(`Candidates: ${payload.candidates.length}`);
  lines.push('');
  lines.push('No trading action. Scores are sourceability/monitoring priority, not expected value.');
  lines.push('');
  for (const [index, candidate] of payload.candidates.slice(0, 25).entries()) {
    lines.push(`## ${index + 1}. [${candidate.platform}] ${candidate.title}`);
    lines.push('');
    lines.push(`- Score: ${candidate.score}`);
    lines.push(`- Ticker/id: ${candidate.ticker || candidate.id}`);
    if (candidate.url) lines.push(`- URL: ${candidate.url}`);
    lines.push(`- Liquidity: ${Math.round(candidate.liquidityUsd || 0)} | Volume: ${Math.round(candidate.volumeUsd || 0)} | Yes price: ${candidate.yesPrice ?? 'n/a'}`);
    lines.push(`- Close: ${candidate.closeTime || 'unknown'} (${candidate.daysLeft ?? 'unknown'} days left)`);
    lines.push(`- Matched: ${candidate.matchedTerms.slice(0, 10).join(', ')}`);
    if (candidate.resolutionSource) lines.push(`- Resolution source: ${String(candidate.resolutionSource).replace(/\s+/g, ' ').slice(0, 280)}`);
    lines.push('- Source plan:');
    for (const item of candidate.sourcePlan) lines.push(`  - ${item}`);
    lines.push('');
  }
  return `${lines.join('\n')}\n`;
}

async function main() {
  ensureDir(DATA_DIR);
  const [polyResult, kalshiResult] = await Promise.allSettled([fetchPolymarketMarkets(), fetchKalshiMarkets()]);
  const polymarket = polyResult.status === 'fulfilled' ? polyResult.value : [];
  const kalshi = kalshiResult.status === 'fulfilled' ? kalshiResult.value : [];
  const payload = {
    generatedAt: new Date().toISOString(),
    mode: 'public_read_non_trading_pilot',
    inputCounts: { polymarket: polymarket.length, kalshi: kalshi.length },
    fetchErrors: [
      polyResult.status === 'rejected' ? { platform: 'polymarket', error: polyResult.reason?.message || String(polyResult.reason) } : null,
      kalshiResult.status === 'rejected' ? { platform: 'kalshi', error: kalshiResult.reason?.message || String(kalshiResult.reason) } : null
    ].filter(Boolean),
    candidates: rank([...polymarket, ...kalshi]).slice(0, 100)
  };
  fs.writeFileSync(path.join(DATA_DIR, 'latest-candidates.json'), `${JSON.stringify(payload, null, 2)}\n`);
  fs.writeFileSync(path.join(DATA_DIR, 'latest-candidates.md'), markdownReport(payload));
  console.log(JSON.stringify({
    generatedAt: payload.generatedAt,
    inputCounts: payload.inputCounts,
    fetchErrors: payload.fetchErrors,
    candidateCount: payload.candidates.length,
    top: payload.candidates.slice(0, 8).map((c) => ({ platform: c.platform, score: c.score, title: c.title, closeTime: c.closeTime, liquidityUsd: c.liquidityUsd, volumeUsd: c.volumeUsd }))
  }, null, 2));
}

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
});
