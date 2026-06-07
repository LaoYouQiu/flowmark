import type { BookmarkSummaryRecord } from './types';

const STORAGE_KEY = 'flowmark.bookmarkSummaries';
const TRACKING_PARAM_PREFIXES = ['utm_'];
const TRACKING_PARAM_NAMES = new Set([
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

type BookmarkSummaryStore = Record<string, BookmarkSummaryRecord>;

export async function getBookmarkSummary(bookmarkId: string): Promise<BookmarkSummaryRecord | null> {
  const store = await getSummaryStore();
  return store[bookmarkId] ?? null;
}

export async function getBookmarkSummaryByNormalizedUrl(url: string): Promise<BookmarkSummaryRecord | null> {
  const normalizedUrl = normalizeBookmarkUrl(url);
  if (!normalizedUrl) return null;

  const store = await getSummaryStore();
  const matches = Object.values(store)
    .filter((record) => record.normalizedUrl === normalizedUrl)
    .sort((a, b) => b.updatedAt - a.updatedAt);

  return matches[0] ?? null;
}

export async function setBookmarkSummary(record: BookmarkSummaryRecord): Promise<void> {
  const store = await getSummaryStore();
  store[record.bookmarkId] = record;
  await browser.storage.local.set({ [STORAGE_KEY]: store });
}

export async function removeBookmarkSummary(bookmarkId: string): Promise<void> {
  const store = await getSummaryStore();
  if (!(bookmarkId in store)) return;
  delete store[bookmarkId];
  await browser.storage.local.set({ [STORAGE_KEY]: store });
}

export async function listRecentBookmarkSummaries(limit: number): Promise<BookmarkSummaryRecord[]> {
  const store = await getSummaryStore();
  return Object.values(store)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, Math.max(0, Math.trunc(limit)));
}

export function normalizeBookmarkUrl(input: string): string | null {
  try {
    const url = new URL(input);
    url.hash = '';
    url.protocol = url.protocol.toLowerCase();
    url.hostname = url.hostname.toLowerCase();
    url.hostname = normalizeHostname(url.hostname);
    url.pathname = normalizePathname(url.pathname);
    url.search = normalizeSearch(url.searchParams);
    url.port = normalizePort(url.protocol, url.port);
    return `${url.origin}${url.pathname}${url.search}`;
  } catch {
    return null;
  }
}

function normalizeHostname(hostname: string): string {
  // Treat common mobile subdomains as the same site to catch duplicates saved
  // from desktop and mobile versions of the same page.
  return hostname.replace(/^m\./, 'www.');
}

function normalizePathname(pathname: string): string {
  const compacted = pathname.replace(/\/{2,}/g, '/');
  return compacted.length > 1 ? compacted.replace(/\/+$/, '') : compacted;
}

function normalizeSearch(searchParams: URLSearchParams): string {
  // Remove marketing/tracking parameters and sort the rest so equivalent query
  // strings compare equal regardless of parameter order.
  const kept: Array<[string, string]> = [];
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

function isTrackingParam(key: string): boolean {
  if (TRACKING_PARAM_NAMES.has(key)) return true;
  return TRACKING_PARAM_PREFIXES.some((prefix) => key.startsWith(prefix));
}

function normalizePort(protocol: string, port: string): string {
  if ((protocol === 'http:' && port === '80') || (protocol === 'https:' && port === '443')) {
    return '';
  }
  return port;
}

async function getSummaryStore(): Promise<BookmarkSummaryStore> {
  const raw = await browser.storage.local.get(STORAGE_KEY);
  const store = raw[STORAGE_KEY];
  if (!store || typeof store !== 'object') return {};

  const entries = Object.entries(store).filter((entry): entry is [string, BookmarkSummaryRecord] => {
    const value = entry[1];
    return Boolean(
      value &&
      typeof value === 'object' &&
      typeof value.bookmarkId === 'string' &&
      typeof value.normalizedUrl === 'string' &&
      typeof value.summary === 'string',
    );
  });

  return Object.fromEntries(entries);
}
