import {
  getBookmarkSummary,
  normalizeBookmarkUrl,
  removeBookmarkSummary,
  setBookmarkSummary,
} from '@/src/shared/bookmark-summary';
import { createTranslator, getCurrentLocale } from '@/src/shared/i18n';
import { messaging } from '@/src/shared/messaging';
import { appendOperationHistoryEntry } from '@/src/shared/operation-history';
import { getResolvedSettings } from '@/src/shared/settings';
import type {
  BookmarkSummaryRecord,
  BookmarkTreeNodeSnapshot,
  DuplicateBookmarkCandidate,
  DuplicateBookmarkGroup,
  DuplicateBookmarkMergeSelection,
  DuplicateBookmarkPreview,
  OperationHistoryChange,
} from '@/src/shared/types';

import { getBookmarksBarId, getRelativeFolderPath } from './engine/helpers';

const MAX_DUPLICATE_GROUPS = 50;

export function initDuplicateBookmarkWorkspace(): void {
  messaging.onMessage('generateDuplicateBookmarkPreview', async () => {
    return await generateDuplicateBookmarkPreview();
  });

  messaging.onMessage('removeDuplicateBookmarks', async ({ data }) => {
    return await removeDuplicateBookmarks(data.bookmarkIds, data.mergeSelections ?? []);
  });
}

async function generateDuplicateBookmarkPreview(): Promise<DuplicateBookmarkPreview> {
  const settings = await getResolvedSettings();
  const locale = await getCurrentLocale(settings.raw);
  const { t } = createTranslator(locale);
  const tree = await browser.bookmarks.getTree();
  const bookmarksBarId = getBookmarksBarId(tree);
  const bookmarksBarLabel = t('common.bookmarksBar');

  const bookmarkNodes = flattenBookmarkNodes(tree);
  const groupsByUrl = new Map<string, DuplicateBookmarkCandidate[]>();

  for (const node of bookmarkNodes) {
    if (!node.url) continue;
    const normalizedUrl = normalizeBookmarkUrl(node.url);
    if (!normalizedUrl) continue;
    const summaryRecord = await getBookmarkSummary(node.id);

    const items = groupsByUrl.get(normalizedUrl) ?? [];
    items.push({
      id: node.id,
      title: node.title?.trim() || t('common.untitled'),
      url: node.url,
      folderPath: getRelativeFolderPath(
        tree,
        bookmarksBarId,
        node.parentId ?? null,
        bookmarksBarLabel,
      ),
      hasSummary: Boolean(summaryRecord?.summary?.trim()),
    });
    groupsByUrl.set(normalizedUrl, items);
  }

  const groups: DuplicateBookmarkGroup[] = [...groupsByUrl.entries()]
    .map(([normalizedUrl, items]) => toDuplicateGroup(normalizedUrl, items))
    .filter((group) => group.items.length > 1)
    .sort((a, b) => b.items.length - a.items.length || a.normalizedUrl.localeCompare(b.normalizedUrl))
    .slice(0, MAX_DUPLICATE_GROUPS);

  return {
    totalBookmarksScanned: bookmarkNodes.length,
    duplicateGroupCount: groups.length,
    groups,
  };
}

async function removeDuplicateBookmarks(
  bookmarkIds: string[],
  mergeSelections: DuplicateBookmarkMergeSelection[],
): Promise<{ removedCount: number }> {
  const historyChanges = await applyMergeMetadataBeforeRemoval(bookmarkIds, mergeSelections);

  let removedCount = 0;

  for (const bookmarkId of bookmarkIds) {
    try {
      const [bookmark] = await browser.bookmarks.get(bookmarkId);
      const summary = await getBookmarkSummary(bookmarkId);
      await browser.bookmarks.remove(bookmarkId);
      await removeBookmarkSummary(bookmarkId);
      if (bookmark?.url && bookmark.parentId) {
        historyChanges.push({
          type: 'delete_bookmark',
          bookmarkId,
          title: bookmark.title,
          url: bookmark.url,
          parentId: bookmark.parentId,
          summary: summary ?? undefined,
        });
      }
      removedCount += 1;
    } catch {
      // Ignore individual failures to keep batch removal going.
    }
  }

  await appendOperationHistoryEntry({
    kind: 'duplicate_cleanup',
    label: `Removed ${removedCount} duplicate bookmarks`,
    changes: historyChanges,
  });

  return { removedCount };
}

function toDuplicateGroup(normalizedUrl: string, items: DuplicateBookmarkCandidate[]): DuplicateBookmarkGroup {
  const keepItem = chooseKeepItem(items);
  const suggestedTitle = chooseBestTitle(items);
  const removeBookmarkIds = items
    .filter((item) => item.id !== keepItem.id)
    .map((item) => item.id);
  const sortedItems = [
    keepItem,
    ...items
      .filter((item) => item.id !== keepItem.id)
      .sort((a, b) => a.folderPath.localeCompare(b.folderPath) || a.title.localeCompare(b.title)),
  ];

  return {
    normalizedUrl,
    url: keepItem.url,
    items: sortedItems,
    keepBookmarkId: keepItem.id,
    suggestedTitle,
    suggestedFolderPath: keepItem.folderPath,
    removeBookmarkIds,
    actions: [
      ...(suggestedTitle !== keepItem.title
        ? [{ type: 'rename' as const, bookmarkId: keepItem.id, title: suggestedTitle }]
        : []),
      ...(items.some((item) => item.id !== keepItem.id && item.hasSummary)
        ? [{
            type: 'merge_summary' as const,
            fromBookmarkIds: items.filter((item) => item.id !== keepItem.id && item.hasSummary).map((item) => item.id),
            toBookmarkId: keepItem.id,
          }]
        : []),
      { type: 'delete', bookmarkIds: removeBookmarkIds },
    ],
  };
}

function chooseKeepItem(items: DuplicateBookmarkCandidate[]): DuplicateBookmarkCandidate {
  return [...items].sort((a, b) => scoreKeepCandidate(b) - scoreKeepCandidate(a) || a.folderPath.localeCompare(b.folderPath))[0] ?? items[0]!;
}

function scoreKeepCandidate(item: DuplicateBookmarkCandidate): number {
  let score = 0;
  if (item.hasSummary) score += 30;
  score += scoreTitle(item.title);
  score += Math.max(0, 8 - item.folderPath.split('-').length);
  return score;
}

function chooseBestTitle(items: DuplicateBookmarkCandidate[]): string {
  return [...items].sort((a, b) => scoreTitle(b.title) - scoreTitle(a.title) || a.title.length - b.title.length)[0]?.title ?? items[0]?.title ?? '';
}

function scoreTitle(title: string): number {
  const normalized = title.trim();
  if (!normalized) return 0;
  let score = 20;
  if (/^https?:\/\//i.test(normalized)) score -= 30;
  if (/^www\./i.test(normalized)) score -= 20;
  if (normalized.length >= 8 && normalized.length <= 64) score += 12;
  if (normalized.length > 100) score -= 15;
  if (/[\u4e00-\u9fff]/u.test(normalized)) score += 4;
  if (/[-_|]/.test(normalized)) score -= 2;
  return score;
}

async function applyMergeMetadataBeforeRemoval(
  bookmarkIds: string[],
  mergeSelections: DuplicateBookmarkMergeSelection[],
): Promise<OperationHistoryChange[]> {
  const changes: OperationHistoryChange[] = [];
  const removeIds = new Set(bookmarkIds);
  if (removeIds.size === 0) return changes;
  const selectionsByUrl = new Map(mergeSelections.map((selection) => [selection.normalizedUrl, selection]));

  const settings = await getResolvedSettings();
  const locale = await getCurrentLocale(settings.raw);
  const { t } = createTranslator(locale);
  const tree = await browser.bookmarks.getTree();
  const bookmarksBarId = getBookmarksBarId(tree);
  const bookmarksBarLabel = t('common.bookmarksBar');
  const bookmarkNodes = flattenBookmarkNodes(tree);
  const affectedUrls = new Set<string>();

  for (const node of bookmarkNodes) {
    if (!node.url || !removeIds.has(node.id)) continue;
    const normalizedUrl = normalizeBookmarkUrl(node.url);
    if (normalizedUrl) affectedUrls.add(normalizedUrl);
  }

  for (const normalizedUrl of affectedUrls) {
    const groupItems: DuplicateBookmarkCandidate[] = [];
    for (const node of bookmarkNodes) {
      if (!node.url || normalizeBookmarkUrl(node.url) !== normalizedUrl) continue;
      groupItems.push({
        id: node.id,
        title: node.title?.trim() || t('common.untitled'),
        url: node.url,
        folderPath: getRelativeFolderPath(tree, bookmarksBarId, node.parentId ?? null, bookmarksBarLabel),
        hasSummary: Boolean((await getBookmarkSummary(node.id))?.summary?.trim()),
      });
    }

    const keepCandidates = groupItems.filter((item) => !removeIds.has(item.id));
    const selectedKeepId = selectionsByUrl.get(normalizedUrl)?.keepBookmarkId;
    const keepItem = keepCandidates.find((item) => item.id === selectedKeepId) ?? chooseKeepItem(keepCandidates);
    if (!keepItem) continue;
    const suggestedTitle = chooseBestTitle(groupItems);
    if (suggestedTitle && suggestedTitle !== keepItem.title) {
      try {
        changes.push({
          type: 'rename_bookmark',
          bookmarkId: keepItem.id,
          fromTitle: keepItem.title,
          toTitle: suggestedTitle,
        });
        await browser.bookmarks.update(keepItem.id, { title: suggestedTitle });
      } catch {
        // Ignore title update failures; deletion can still proceed.
      }
    }

    await transferBestSummary({
      groupItems,
      keepItem,
      suggestedTitle: suggestedTitle || keepItem.title,
      normalizedUrl,
    });
  }

  return changes;
}

async function transferBestSummary(input: {
  groupItems: DuplicateBookmarkCandidate[];
  keepItem: DuplicateBookmarkCandidate;
  suggestedTitle: string;
  normalizedUrl: string;
}): Promise<void> {
  const keepSummary = await getBookmarkSummary(input.keepItem.id);
  if (keepSummary?.summary?.trim()) return;

  for (const item of input.groupItems) {
    if (item.id === input.keepItem.id) continue;
    const summaryRecord = await getBookmarkSummary(item.id);
    if (!summaryRecord?.summary?.trim()) continue;

    const now = Date.now();
    const record: BookmarkSummaryRecord = {
      bookmarkId: input.keepItem.id,
      url: input.keepItem.url,
      normalizedUrl: input.normalizedUrl,
      title: input.suggestedTitle,
      folderPath: input.keepItem.folderPath,
      summary: summaryRecord.summary.trim(),
      createdAt: keepSummary?.createdAt ?? summaryRecord.createdAt ?? now,
      updatedAt: now,
    };
    await setBookmarkSummary(record);
    return;
  }
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
