import { getBookmarkSuggestion } from '@/src/shared/bookmark-ai';
import { getBookmarkSummary, normalizeBookmarkUrl, setBookmarkSummary } from '@/src/shared/bookmark-summary';
import { createTranslator, getCurrentLocale } from '@/src/shared/i18n';
import { messaging } from '@/src/shared/messaging';
import { getResolvedSettings } from '@/src/shared/settings';
import type {
  BookmarkSummaryRecord,
  BookmarkTreeNodeSnapshot,
  PageContent,
  SummarySearchResult,
  SummarySearchResultItem,
  SummaryToolItem,
  SummaryToolPreview,
} from '@/src/shared/types';

import { collectFolderPaths, getBookmarksBarId, getRelativeFolderPath } from './engine/helpers';

const MAX_SUMMARY_PREVIEW_ITEMS = 30;
const MAX_SUMMARY_SEARCH_RESULTS = 50;
const PAGE_TEXT_LIMIT = 5000;

export function initSummaryToolWorkspace(): void {
  messaging.onMessage('generateSummaryToolPreview', async () => {
    return await generateSummaryToolPreview();
  });

  messaging.onMessage('generateBookmarkSummaries', async ({ data }) => {
    return await generateBookmarkSummaries(data.bookmarkIds);
  });

  messaging.onMessage('searchBookmarkSummaries', async ({ data }) => {
    return await searchBookmarkSummaries(data.query, data.limit);
  });
}

async function generateSummaryToolPreview(): Promise<SummaryToolPreview> {
  const settings = await getResolvedSettings();
  const locale = await getCurrentLocale(settings.raw);
  const { t } = createTranslator(locale);
  const tree = await browser.bookmarks.getTree();
  const bookmarksBarId = getBookmarksBarId(tree);
  const bookmarksBarLabel = t('common.bookmarksBar');
  const bookmarkNodes = flattenBookmarkNodes(tree);
  const items: SummaryToolItem[] = [];

  for (const node of bookmarkNodes) {
    if (!node.url) continue;
    if (!/^https?:\/\//i.test(node.url)) continue;
    if (items.length >= MAX_SUMMARY_PREVIEW_ITEMS) break;

    const summaryRecord = await getBookmarkSummary(node.id);
    items.push({
      bookmarkId: node.id,
      url: node.url,
      title: node.title?.trim() || t('common.untitled'),
      folderPath: getRelativeFolderPath(
        tree,
        bookmarksBarId,
        node.parentId ?? null,
        bookmarksBarLabel,
      ),
      summary: summaryRecord?.summary ?? null,
      hasSummary: Boolean(summaryRecord?.summary?.trim()),
    });
  }

  return {
    totalBookmarksScanned: bookmarkNodes.length,
    missingSummaryCount: items.filter((item) => !item.hasSummary).length,
    items,
  };
}

async function generateBookmarkSummaries(bookmarkIds: string[]): Promise<{ updatedCount: number }> {
  const settings = await getResolvedSettings();
  const locale = await getCurrentLocale(settings.raw);
  const { t } = createTranslator(locale);
  if (!settings.features.summary.enabled) {
    return { updatedCount: 0 };
  }

  const tree = await browser.bookmarks.getTree();
  const bookmarksBarId = getBookmarksBarId(tree);
  const bookmarksBarLabel = t('common.bookmarksBar');
  const folderPaths = collectFolderPaths(tree, bookmarksBarId);
  let updatedCount = 0;

  for (const bookmarkId of bookmarkIds) {
    try {
      const [bookmark] = await browser.bookmarks.get(bookmarkId);
      if (!bookmark?.url) continue;

      const suggestion = await getBookmarkSuggestion({
        settings: settings.raw,
        locale,
        url: bookmark.url,
        originalTitle: bookmark.title ?? '',
        pageContent: toPreviewPageContent({
          title: bookmark.title ?? '',
          url: bookmark.url,
        }),
        folderPaths,
        summaryEnabled: true,
        untitledFallback: t('common.untitled'),
      });

      const summary = suggestion?.summary?.trim();
      const normalizedUrl = normalizeBookmarkUrl(bookmark.url);
      if (!summary || !normalizedUrl) continue;

      const existing = await getBookmarkSummary(bookmark.id);
      const now = Date.now();
      const record: BookmarkSummaryRecord = {
        bookmarkId: bookmark.id,
        url: bookmark.url,
        normalizedUrl,
        title: bookmark.title ?? t('common.untitled'),
        folderPath: getRelativeFolderPath(
          tree,
          bookmarksBarId,
          bookmark.parentId ?? null,
          bookmarksBarLabel,
        ),
        summary,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      };
      await setBookmarkSummary(record);
      updatedCount += 1;
    } catch {
      // Ignore individual failures to keep the batch running.
    }
  }

  return { updatedCount };
}

async function searchBookmarkSummaries(query: string, limit?: number): Promise<SummarySearchResult> {
  // Search is intentionally local and deterministic: it scans current bookmarks
  // plus FlowMark's saved summaries, without making any AI/network calls.
  const normalizedQuery = normalizeSearchText(query);
  const normalizedTerms = normalizedQuery.split(' ').filter(Boolean);
  const maxResults = Math.max(1, Math.min(100, Math.trunc(limit ?? MAX_SUMMARY_SEARCH_RESULTS)));
  const settings = await getResolvedSettings();
  const locale = await getCurrentLocale(settings.raw);
  const { t } = createTranslator(locale);
  const tree = await browser.bookmarks.getTree();
  const bookmarksBarId = getBookmarksBarId(tree);
  const bookmarksBarLabel = t('common.bookmarksBar');
  const bookmarkNodes = flattenBookmarkNodes(tree);
  const matches: Array<SummarySearchResultItem & { score: number }> = [];

  for (const node of bookmarkNodes) {
    if (!node.url) continue;
    const summaryRecord = await getBookmarkSummary(node.id);
    if (!summaryRecord?.summary?.trim()) continue;

    const folderPath = getRelativeFolderPath(tree, bookmarksBarId, node.parentId ?? null, bookmarksBarLabel);
    const haystack = normalizeSearchText([
      node.title,
      node.url,
      folderPath,
      summaryRecord.summary,
    ].join(' '));
    const score = scoreSummarySearchMatch(haystack, normalizedQuery, normalizedTerms);
    if (score <= 0) continue;

    matches.push({
      bookmarkId: node.id,
      url: node.url,
      title: node.title?.trim() || t('common.untitled'),
      folderPath,
      summary: summaryRecord.summary.trim(),
      updatedAt: summaryRecord.updatedAt,
      score,
    });
  }

  const items = matches
    .sort((a, b) => b.score - a.score || b.updatedAt - a.updatedAt)
    .slice(0, maxResults)
    .map(({ score: _score, ...item }) => item);

  return {
    query: query.trim(),
    totalBookmarksScanned: bookmarkNodes.length,
    matchCount: matches.length,
    items,
  };
}

function flattenBookmarkNodes(tree: BookmarkTreeNodeSnapshot[]): BookmarkTreeNodeSnapshot[] {
  const result: BookmarkTreeNodeSnapshot[] = [];
  const stack = [...tree];

  while (stack.length > 0) {
    const node = stack.pop();
    if (!node) break;
    if (node.url) result.push(node);
    for (const child of node.children ?? []) {
      stack.push(child);
    }
  }

  return result;
}

function toPreviewPageContent(node: Pick<BookmarkTreeNodeSnapshot, 'title' | 'url'>): PageContent {
  const title = node.title?.trim() ?? '';

  return {
    url: node.url ?? '',
    title,
    description: '',
    headings: title ? [title] : [],
    text: title.slice(0, PAGE_TEXT_LIMIT) || null,
    hasPasswordField: false,
    formFieldCount: 0,
    linkCount: 0,
  };
}

function scoreSummarySearchMatch(haystack: string, query: string, terms: string[]): number {
  if (!query) return 0;
  if (haystack.includes(query)) return 100 + query.length;
  let score = 0;
  for (const term of terms) {
    if (haystack.includes(term)) score += Math.max(1, term.length);
  }
  return terms.length > 0 && score === 0 ? 0 : score;
}

function normalizeSearchText(value: string): string {
  return value.toLowerCase().replace(/\s+/g, ' ').trim();
}
