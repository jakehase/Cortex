#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA_DIR = path.join(ROOT, 'data');
const EVIDENCE_DIR = path.join(DATA_DIR, 'evidence');
const CACHE_DIR = path.join(DATA_DIR, 'cache');
const SCOTUS_DOCKET_CACHE_PATH = path.join(CACHE_DIR, 'scotus-docket-searches.json');
const USER_AGENT = 'CatalystRadarPilot/0.1 (+public-legal-source-monitoring; no-trading)';
const SCOTUS_BASE = 'https://www.supremecourt.gov';
const ORDER_SCAN_LIMIT = Number(process.env.CATALYST_SCOTUS_ORDER_SCAN_LIMIT || 120);
const SCOTUS_RELEVANCE_TERMS = [
  'Kalshi',
  'KalshiEx',
  'sports event contracts',
  'sports event contract',
  'event contracts',
  'event contract',
  'Mary Jo Flaherty'
];

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function readJsonFallback(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { return fallback; }
}

function writeJson(file, payload) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`);
}

async function fetchJson(url) {
  const res = await fetch(url, { headers: { accept: 'application/json', 'user-agent': USER_AGENT } });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  return res.json();
}

async function fetchText(url, options = {}) {
  const res = await fetch(url, { headers: { 'user-agent': USER_AGENT, ...(options.headers || {}) }, method: options.method || 'GET', body: options.body || undefined });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  return res.text();
}

async function fetchBuffer(url) {
  const res = await fetch(url, { headers: { 'user-agent': USER_AGENT, accept: 'application/pdf,*/*' } });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

function htmlDecode(value = '') {
  return String(value || '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function stripHtml(value = '') {
  return htmlDecode(String(value || '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function normalizeSearchText(value = '') {
  return String(value || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function compactSearchText(value = '') {
  return normalizeSearchText(value).replace(/[^a-z0-9]+/g, '');
}

function termHit(text, term) {
  const normal = normalizeSearchText(text);
  const compact = compactSearchText(text);
  const termNormal = normalizeSearchText(term);
  const termCompact = compactSearchText(term);
  return normal.includes(termNormal) || (termCompact.length >= 5 && compact.includes(termCompact));
}

function normalizeCourtListenerResult(result) {
  return {
    source: 'courtlistener',
    type: result.type || null,
    caseName: result.caseName || result.caseNameFull || result.case_name || null,
    court: result.court || result.court_citation_string || null,
    dateFiled: result.dateFiled || result.date_filed || null,
    docketNumber: result.docketNumber || result.docket_number || null,
    citation: result.citation || result.citeCount ? String(result.citation || '') : null,
    url: result.absolute_url ? `https://www.courtlistener.com${result.absolute_url}` : result.cluster ? `https://www.courtlistener.com${result.cluster}` : null,
    snippet: String(result.snippet || result.suitNature || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim().slice(0, 800)
  };
}

async function courtListenerSearch(query) {
  const url = new URL('https://www.courtlistener.com/api/rest/v4/search/');
  url.searchParams.set('q', query);
  url.searchParams.set('type', 'o');
  const payload = await fetchJson(url.toString());
  return {
    query,
    count: payload.count || 0,
    results: (payload.results || []).slice(0, 5).map(normalizeCourtListenerResult)
  };
}

function extractHiddenField(html, name) {
  const pattern = new RegExp(`<input[^>]+name=["']${name.replace(/[$]/g, '\\$')}["'][^>]*>`, 'i');
  const tag = pattern.exec(html)?.[0] || '';
  const value = /value=["']([^"']*)["']/i.exec(tag)?.[1] || '';
  return htmlDecode(value);
}

function extractDocketResultLinks(html) {
  const results = [];
  for (const match of html.matchAll(/<a[^>]+href=["']([^"']*docketfiles\/html\/public\/[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const href = htmlDecode(match[1]);
    const text = stripHtml(match[2]);
    results.push({
      title: text || href.split('/').at(-1),
      url: href.startsWith('http') ? href : new URL(href, SCOTUS_BASE).toString()
    });
  }
  return results;
}

async function enrichDocketResultLinks(resultLinks) {
  const enriched = [];
  for (const link of resultLinks.slice(0, 20)) {
    try {
      const html = await fetchText(link.url, { headers: { accept: 'text/html,*/*' } });
      const text = stripHtml(html);
      const relevanceHitTerms = SCOTUS_RELEVANCE_TERMS.filter((term) => termHit(text, term));
      enriched.push({ ...link, relevanceHitTerms, relevantToMarket: relevanceHitTerms.length > 0 });
    } catch (error) {
      enriched.push({ ...link, relevanceHitTerms: [], relevantToMarket: false, fetchError: error.message });
    }
  }
  return enriched;
}

async function scotusDocketSearch(query) {
  const docketUrl = `${SCOTUS_BASE}/docket/docket.aspx`;
  const cache = readJsonFallback(SCOTUS_DOCKET_CACHE_PATH, {});
  const initial = await fetchText(docketUrl, { headers: { accept: 'text/html,*/*' } });
  const form = new URLSearchParams();
  for (const name of ['ctl00_ctl00_RadScriptManager1_TSM', '__EVENTTARGET', '__EVENTARGUMENT', '__VIEWSTATE', '__VIEWSTATEGENERATOR', '__EVENTVALIDATION']) {
    form.set(name, extractHiddenField(initial, name));
  }
  form.set('ctl00$ctl00$txtSearch', '');
  form.set('ctl00$ctl00$MainEditable$mainContent$txtQuery', query);
  form.set('ctl00$ctl00$MainEditable$mainContent$cmdSearch', 'Search');
  const html = await fetchText(docketUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', referer: docketUrl, accept: 'text/html,*/*' },
    body: form
  });
  const noItems = /No items found for:/i.test(html);
  const resultLinks = await enrichDocketResultLinks(extractDocketResultLinks(html).slice(0, 20));
  const result = {
    query,
    officialSource: `${SCOTUS_BASE}/docket/docket.aspx`,
    sourceStatus: 'live',
    noItemsFound: noItems,
    resultLinks,
    relevantResultLinks: resultLinks.filter((entry) => entry.relevantToMarket),
    responseContainsQuery: termHit(html, query)
  };
  cache[query] = { ...result, cachedAt: new Date().toISOString() };
  writeJson(SCOTUS_DOCKET_CACHE_PATH, cache);
  return result;
}

async function scotusDocketSearchWithCache(query) {
  try {
    return await scotusDocketSearch(query);
  } catch (error) {
    const cache = readJsonFallback(SCOTUS_DOCKET_CACHE_PATH, {});
    if (cache[query]) {
      return {
        ...cache[query],
        sourceStatus: 'cached_after_live_fetch_error',
        liveFetchError: error.message
      };
    }
    return {
      query,
      officialSource: `${SCOTUS_BASE}/docket/docket.aspx`,
      sourceStatus: 'live_fetch_error_no_cache',
      error: error.message,
      noItemsFound: null,
      resultLinks: [],
      relevantResultLinks: []
    };
  }
}

function extractPdfLinksFromOrdersPage(html) {
  const links = [];
  for (const match of html.matchAll(/href=["']([^"']*\/orders\/courtorders\/[^"']+\.pdf)["']/gi)) {
    const href = htmlDecode(match[1]);
    const url = href.startsWith('http') ? href : new URL(href, SCOTUS_BASE).toString();
    const file = url.split('/').at(-1);
    if (!links.some((entry) => entry.url === url)) links.push({ url, file });
  }
  return links;
}

function decodePdfLiteral(raw) {
  return raw
    .replace(/\\([nrtbf()\\])/g, (_m, ch) => ({ n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', '(': '(', ')': ')', '\\': '\\' }[ch] || ch))
    .replace(/\\([0-7]{1,3})/g, (_m, octal) => String.fromCharCode(Number.parseInt(octal, 8)));
}

function extractBestEffortPdfText(buffer) {
  const parts = [];
  const binary = buffer.toString('binary');
  const streamRe = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
  for (const match of binary.matchAll(streamRe)) {
    const streamBuffer = Buffer.from(match[1], 'binary');
    let inflated = null;
    try { inflated = zlib.inflateSync(streamBuffer).toString('latin1'); } catch {}
    if (!inflated) {
      try { inflated = zlib.inflateRawSync(streamBuffer).toString('latin1'); } catch {}
    }
    const text = inflated || streamBuffer.toString('latin1');
    for (const literal of text.matchAll(/\((?:\\.|[^\\)])*\)/g)) {
      const decoded = decodePdfLiteral(literal[0].slice(1, -1));
      if (/[A-Za-z]{2}/.test(decoded)) parts.push(decoded);
    }
  }
  const asciiFallback = binary.replace(/[^\x20-\x7e]+/g, ' ');
  return `${parts.join(' ')}\n${asciiFallback}`.replace(/\s+/g, ' ').trim();
}

function snippetsForTerms(text, terms, radius = 260) {
  const normal = normalizeSearchText(text);
  const compact = compactSearchText(text);
  const snippets = [];
  for (const term of terms) {
    const termNormal = normalizeSearchText(term);
    let idx = normal.indexOf(termNormal);
    if (idx === -1 && compact.includes(compactSearchText(term))) idx = 0;
    if (idx !== -1) snippets.push({ term, snippet: normal.slice(Math.max(0, idx - radius), idx + termNormal.length + radius) });
  }
  return snippets;
}

async function scanScotusOrderLists(terms) {
  const ordersUrl = `${SCOTUS_BASE}/orders/ordersofthecourt/`;
  let liveFetchError = null;
  let pdfLinks = [];
  try {
    const html = await fetchText(ordersUrl, { headers: { accept: 'text/html,*/*' } });
    pdfLinks = extractPdfLinksFromOrdersPage(html).slice(0, ORDER_SCAN_LIMIT);
  } catch (error) {
    liveFetchError = error.message;
    const cacheOrderDir = path.join(CACHE_DIR, 'scotus-orders');
    pdfLinks = fs.existsSync(cacheOrderDir)
      ? fs.readdirSync(cacheOrderDir)
        .filter((file) => file.endsWith('.pdf'))
        .sort()
        .slice(0, ORDER_SCAN_LIMIT)
        .map((file) => ({ file, url: `${SCOTUS_BASE}/orders/courtorders/${file}`, cacheOnly: true }))
      : [];
  }
  const matches = [];
  const errors = [];
  fs.mkdirSync(path.join(CACHE_DIR, 'scotus-orders'), { recursive: true });
  for (const link of pdfLinks) {
    try {
      const cachePath = path.join(CACHE_DIR, 'scotus-orders', link.file);
      const buffer = fs.existsSync(cachePath) ? fs.readFileSync(cachePath) : await fetchBuffer(link.url);
      if (!fs.existsSync(cachePath)) fs.writeFileSync(cachePath, buffer);
      const text = extractBestEffortPdfText(buffer);
      const hitTerms = terms.filter((term) => termHit(text, term));
      if (hitTerms.length) {
        matches.push({
          file: link.file,
          url: link.url,
          hitTerms,
          certiorariMentioned: termHit(text, 'certiorari'),
          grantMentioned: termHit(text, 'granted'),
          snippets: snippetsForTerms(text, hitTerms).slice(0, 8)
        });
      }
    } catch (error) {
      errors.push({ file: link.file, url: link.url, error: error.message });
    }
  }
  return {
    officialSource: ordersUrl,
    sourceStatus: liveFetchError ? 'cached_after_live_fetch_error' : 'live',
    liveFetchError,
    pdfCountDiscovered: pdfLinks.length,
    pdfCountScanned: pdfLinks.length - errors.length,
    terms,
    matches,
    errors
  };
}

function markdown(pack) {
  const lines = [];
  lines.push(`# Evidence pack: ${pack.market.title}`);
  lines.push('');
  lines.push(`Generated: ${pack.generatedAt}`);
  lines.push(`Market: ${pack.market.platform} / ${pack.market.ticker}`);
  lines.push(`URL: ${pack.market.url}`);
  lines.push(`Trading action: ${pack.tradingAction}`);
  lines.push(`Probability delta ready: ${pack.probabilityDeltaReady}`);
  lines.push(`Source confidence: ${pack.sourceConfidence}`);
  lines.push('');
  lines.push('## Observed facts');
  for (const fact of pack.observedFacts) lines.push(`- ${fact}`);
  lines.push('');
  lines.push('## Source queries');
  for (const query of pack.sourceQueries) {
    lines.push(`### ${query.query}`);
    lines.push(`- Count: ${query.count}`);
    for (const result of query.results) {
      lines.push(`  - ${result.caseName || 'Unknown case'}${result.dateFiled ? ` (${result.dateFiled})` : ''}${result.url ? ` — ${result.url}` : ''}`);
    }
  }
  if (pack.scotusDocketSearches?.length) {
    lines.push('');
    lines.push('## Official SCOTUS docket searches');
    for (const search of pack.scotusDocketSearches) {
      lines.push(`### ${search.query}`);
      lines.push(`- Source: ${search.officialSource}`);
      lines.push(`- Source status: ${search.sourceStatus || 'unknown'}${search.cachedAt ? ` (cached at ${search.cachedAt})` : ''}${search.liveFetchError ? `; live fetch error: ${search.liveFetchError}` : ''}`);
      lines.push(`- No items found: ${search.noItemsFound}`);
      lines.push(`- Result links: ${search.resultLinks.length}`);
      lines.push(`- Relevant result links: ${(search.relevantResultLinks || []).length}`);
      for (const link of search.resultLinks.slice(0, 8)) {
        const relevance = link.relevanceHitTerms?.length ? ` — relevance terms: ${link.relevanceHitTerms.join(', ')}` : '';
        lines.push(`  - ${link.title} — ${link.url}${relevance}`);
      }
    }
  }
  if (pack.scotusOrderListScan) {
    lines.push('');
    lines.push('## Official SCOTUS orders-list scan');
    lines.push(`- Source: ${pack.scotusOrderListScan.officialSource}`);
    lines.push(`- Source status: ${pack.scotusOrderListScan.sourceStatus || 'unknown'}${pack.scotusOrderListScan.liveFetchError ? `; live fetch error: ${pack.scotusOrderListScan.liveFetchError}` : ''}`);
    lines.push(`- PDFs discovered: ${pack.scotusOrderListScan.pdfCountDiscovered}`);
    lines.push(`- PDFs scanned: ${pack.scotusOrderListScan.pdfCountScanned}`);
    lines.push(`- Matches: ${pack.scotusOrderListScan.matches.length}`);
    for (const match of pack.scotusOrderListScan.matches.slice(0, 10)) {
      lines.push(`  - ${match.file} — terms: ${match.hitTerms.join(', ')} — ${match.url}`);
      for (const snippet of match.snippets.slice(0, 2)) lines.push(`    - ${snippet.term}: ${snippet.snippet}`);
    }
  }
  lines.push('');
  lines.push('## Ambiguities / red-team checks');
  for (const item of pack.ambiguities) lines.push(`- ${item}`);
  lines.push('');
  return `${lines.join('\n')}\n`;
}

async function main() {
  const scan = readJson(path.join(DATA_DIR, 'latest-candidates.json'));
  const market = scan.candidates.find((candidate) => /SCOTUS accepts sports event contract case/i.test(candidate.title));
  if (!market) throw new Error('scotus_sports_event_contract_candidate_not_found; run scripts/pilot-scan.mjs first');

  const queries = [
    'Kalshi sports event contracts CFTC New Jersey Third Circuit',
    'KalshiEx LLC Mary Jo Flaherty sports event contracts',
    'sports event contracts Commodity Exchange Act Kalshi CFTC',
    'Supreme Court Kalshi sports event contracts petition'
  ];
  const officialSearchQueries = [
    'Kalshi',
    'KalshiEx',
    'sports event contracts',
    'Commodity Futures Trading Commission',
    'Mary Jo Flaherty'
  ];
  const officialOrderSearchTerms = [
    'Kalshi',
    'KalshiEx',
    'sports event contracts',
    'event contracts',
    'Commodity Futures Trading Commission',
    'Mary Jo Flaherty',
    'CFTC'
  ];
  const sourceQueries = [];
  for (const query of queries) {
    try {
      sourceQueries.push(await courtListenerSearch(query));
    } catch (error) {
      sourceQueries.push({ query, error: error.message, count: 0, results: [] });
    }
  }

  const scotusDocketSearches = [];
  for (const query of officialSearchQueries) {
    try {
      scotusDocketSearches.push(await scotusDocketSearchWithCache(query));
    } catch (error) {
      scotusDocketSearches.push({ query, officialSource: `${SCOTUS_BASE}/docket/docket.aspx`, error: error.message, noItemsFound: null, resultLinks: [] });
    }
  }

  let scotusOrderListScan = null;
  try {
    scotusOrderListScan = await scanScotusOrderLists(officialOrderSearchTerms);
  } catch (error) {
    scotusOrderListScan = {
      officialSource: `${SCOTUS_BASE}/orders/ordersofthecourt/`,
      error: error.message,
      pdfCountDiscovered: 0,
      pdfCountScanned: 0,
      terms: officialOrderSearchTerms,
      matches: [],
      errors: []
    };
  }

  const allResults = sourceQueries.flatMap((entry) => entry.results || []);
  const uniqueCaseNames = [...new Set(allResults.map((entry) => entry.caseName).filter(Boolean))];
  const hasKalshiCase = allResults.some((entry) => /kalshi/i.test(`${entry.caseName || ''} ${entry.snippet || ''}`));
  const officialDocketHits = scotusDocketSearches.flatMap((entry) => entry.resultLinks || []);
  const relevantOfficialDocketHits = scotusDocketSearches.flatMap((entry) => entry.relevantResultLinks || []);
  const officialOrderHits = scotusOrderListScan?.matches || [];
  const officialScotusHit = relevantOfficialDocketHits.length > 0 || officialOrderHits.length > 0;
  const officialCertGrantEvidence = officialOrderHits.some((entry) => entry.certiorariMentioned && entry.grantMentioned)
    || relevantOfficialDocketHits.some((entry) => /certiorari|granted/i.test(`${entry.title || ''} ${entry.url || ''}`));
  const docketSourceStatuses = [...new Set(scotusDocketSearches.map((entry) => entry.sourceStatus || 'unknown'))];
  const orderSourceStatus = scotusOrderListScan?.sourceStatus || 'unknown';

  const pack = {
    generatedAt: new Date().toISOString(),
    mode: 'read_only_source_agent_probe',
    market: {
      platform: market.platform,
      ticker: market.ticker,
      title: market.title,
      url: market.url,
      closeTime: market.closeTime,
      yesPrice: market.yesPrice,
      liquidityUsd: market.liquidityUsd,
      volumeUsd: market.volumeUsd,
      description: market.description
    },
    sourceQueries,
    scotusDocketSearches,
    scotusOrderListScan,
    observedFacts: [
      `Market candidate selected from latest scan with score ${market.score}.`,
      hasKalshiCase
        ? 'CourtListener search found at least one Kalshi-related legal result that appears relevant to sports/event-contract litigation.'
        : 'CourtListener search did not find a clearly matching Kalshi sports-event-contract result in the first result window.',
      uniqueCaseNames.length ? `Distinct case names observed: ${uniqueCaseNames.slice(0, 8).join('; ')}.` : 'No distinct case names observed from CourtListener probe.',
      officialDocketHits.length
        ? `Official SCOTUS docket search returned ${officialDocketHits.length} broad result link(s), of which ${relevantOfficialDocketHits.length} matched market-specific terms.`
        : `Official SCOTUS docket search returned no result links for: ${officialSearchQueries.join(', ')}.`,
      officialOrderHits.length
        ? `Official SCOTUS orders-list scan found ${officialOrderHits.length} PDF(s) with candidate terms.`
        : `Official SCOTUS orders-list scan found no PDFs containing the candidate terms across ${scotusOrderListScan?.pdfCountScanned || 0} scanned order-list PDFs.`,
      `SCOTUS direct-source status: docket=${docketSourceStatuses.join(', ') || 'unknown'}; orders=${orderSourceStatus}.`,
      officialCertGrantEvidence
        ? 'Official-source cert-grant evidence was found and needs human/secondary verification before probability modeling.'
        : 'No official-source cert-grant evidence was found in the available SCOTUS docket/order-list checks.'
    ],
    counterEvidence: [],
    ambiguities: [
      'The market permits any qualifying SCOTUS cert grant, so a complete monitor must track multiple candidate cases/petitions rather than only Kalshi-named dockets.',
      'Official SCOTUS search can lag or require exact party/docket strings; no-hit evidence is useful but not conclusive absence.',
      'The best-effort PDF extractor can miss text if future SCOTUS PDFs use unsupported encodings; matches/no-matches should be paired with docket search and orders-page metadata.',
      'Legal commentary can help identify candidate cases, but cannot be used as primary resolution evidence.',
      'If multiple prediction-market/sports-event-contract cases exist, the source agent must disambiguate party names, docket numbers, and petition status.'
    ],
    sourceConfidence: officialCertGrantEvidence ? 0.75 : officialScotusHit ? 0.55 : hasKalshiCase ? 0.45 : 0.2,
    probabilityDeltaReady: officialCertGrantEvidence,
    tradingAction: 'none'
  };

  const slug = 'scotus-sports-event-contract';
  writeJson(path.join(EVIDENCE_DIR, `${slug}.json`), pack);
  fs.writeFileSync(path.join(EVIDENCE_DIR, `${slug}.md`), markdown(pack));
  console.log(JSON.stringify({
    market: pack.market.title,
    sourceQueries: sourceQueries.length,
    courtListenerResults: allResults.length,
    officialDocketHits: officialDocketHits.length,
    relevantOfficialDocketHits: relevantOfficialDocketHits.length,
    officialOrderListMatches: officialOrderHits.length,
    sourceConfidence: pack.sourceConfidence,
    probabilityDeltaReady: pack.probabilityDeltaReady,
    output: `data/evidence/${slug}.json`
  }, null, 2));
}

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
});
