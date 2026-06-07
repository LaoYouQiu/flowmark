const trackingParamPrefixes = ['utm_'];
const trackingParamNames = new Set([
  'fbclid',
  'gclid',
  'gbraid',
  'wbraid',
  'igshid',
  'mc_cid',
  'mc_eid',
  'mkt_tok',
  'spm',
  'ref',
  'ref_src',
]);

const cases = [
  [
    'https://example.com/article?utm_source=x&id=1#comments',
    'https://example.com/article?id=1',
  ],
  [
    'https://example.com/article?b=2&a=1',
    'https://example.com/article?a=1&b=2',
  ],
  [
    'https://m.example.com/article/',
    'https://www.example.com/article',
  ],
  [
    'https://example.com:443/article//',
    'https://example.com/article',
  ],
];

for (const [input, expected] of cases) {
  const actual = normalizeBookmarkUrl(input);
  if (actual !== expected) {
    throw new Error(`Expected ${input} -> ${expected}, got ${actual}`);
  }
}

console.log(`URL normalization checks passed (${cases.length})`);

function normalizeBookmarkUrl(input) {
  const url = new URL(input);
  url.hash = '';
  url.protocol = url.protocol.toLowerCase();
  url.hostname = normalizeHostname(url.hostname.toLowerCase());
  url.pathname = normalizePathname(url.pathname);
  url.search = normalizeSearch(url.searchParams);
  url.port = normalizePort(url.protocol, url.port);
  return `${url.origin}${url.pathname}${url.search}`;
}

function normalizeHostname(hostname) {
  // Keep this script aligned with src/shared/bookmark-summary.ts.
  return hostname.replace(/^m\./, 'www.');
}

function normalizePathname(pathname) {
  const compacted = pathname.replace(/\/{2,}/g, '/');
  return compacted.length > 1 ? compacted.replace(/\/+$/, '') : compacted;
}

function normalizeSearch(searchParams) {
  const kept = [];
  for (const [key, value] of searchParams.entries()) {
    const normalizedKey = key.toLowerCase();
    if (isTrackingParam(normalizedKey)) continue;
    kept.push([normalizedKey, value]);
  }

  kept.sort(([keyA, valueA], [keyB, valueB]) =>
    keyA.localeCompare(keyB) || valueA.localeCompare(valueB),
  );

  const normalized = new URLSearchParams();
  for (const [key, value] of kept) normalized.append(key, value);
  const query = normalized.toString();
  return query ? `?${query}` : '';
}

function isTrackingParam(key) {
  if (trackingParamNames.has(key)) return true;
  return trackingParamPrefixes.some((prefix) => key.startsWith(prefix));
}

function normalizePort(protocol, port) {
  if ((protocol === 'http:' && port === '80') || (protocol === 'https:' && port === '443')) {
    return '';
  }
  return port;
}
