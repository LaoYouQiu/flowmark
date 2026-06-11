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
  DuplicateBookmarkScanJobSnapshot,
  OperationHistoryChange,
} from '@/src/shared/types';

import { getBookmarksBarId, getRelativeFolderPath } from './engine/helpers';

const MAX_DUPLICATE_GROUPS = 50;
const DUPLICATE_SCAN_BATCH_SIZE = 250;

type DuplicateBookmarkScanJob = {
  id: string;
  status: DuplicateBookmarkScanJobSnapshot['status'];
  totalBookmarksScanned: number;
  scanned: number;
  bookmarkNodes: BookmarkTreeNodeSnapshot[];
  cursor: number;
  groupsByUrl: Map<string, DuplicateBookmarkCandidate[]>;
  tree: BookmarkTreeNodeSnapshot[];
  bookmarksBarId: string | null;
  bookmarksBarLabel: string;
  untitledFallback: string;
  error?: string;
};

let activeDuplicateBookmarkScanJob: DuplicateBookmarkScanJob | null = null;

export function initDuplicateBookmarkWorkspace(): void {
  // Workspace API used by the Duplicate Cleanup page. Preview is read-only;
  // removal applies the user's current keep/delete selections.
  messaging.onMessage('generateDuplicateBookmarkPreview', async () => {
    return await generateDuplicateBookmarkPreview();
  });

  messaging.onMessage('startDuplicateBookmarkScanJob', async () => {
    return await startDuplicateBookmarkScanJob();
  });

  messaging.onMessage('runDuplicateBookmarkScanJobBatch', async ({ data }) => {
    return await runDuplicateBookmarkScanJobBatch(data.jobId);
  });

  messaging.onMessage('cancelDuplicateBookmarkScanJob', async ({ data }) => {
    return cancelDuplicateBookmarkScanJob(data.jobId);
  });

  messaging.onMessage('removeDuplicateBookmarks', async ({ data }) => {
    return await removeDuplicateBookmarks(data.bookmarkIds, data.mergeSelections ?? []);
  });
}

async function generateDuplicateBookmarkPreview(): Promise<DuplicateBookmarkPreview> {
  const initialJob = await startDuplicateBookmarkScanJob();
  let current = initialJob;
  while (current.status === 'running') {
    current = await runDuplicateBookmarkScanJobBatch(current.id);
  }
  return {
    totalBookmarksScanned: current.totalBookmarksScanned,
    duplicateGroupCount: current.duplicateGroupCount,
    groups: current.groups,
  };
}

async function startDuplicateBookmarkScanJob(): Promise<DuplicateBookmarkScanJobSnapshot> {
  const settings = await getResolvedSettings();
  const locale = await getCurrentLocale(settings.raw);
  const { t } = createTranslator(locale);
  const tree = await browser.bookmarks.getTree();
  const bookmarksBarId = getBookmarksBarId(tree);
  const bookmarksBarLabel = t('common.bookmarksBar');
  const bookmarkNodes = flattenBookmarkNodes(tree);

  activeDuplicateBookmarkScanJob = {
    id: `${Date.now()}:${Math.random().toString(36).slice(2)}`,
    status: 'running',
    totalBookmarksScanned: bookmarkNodes.length,
    scanned: 0,
    bookmarkNodes,
    cursor: 0,
    groupsByUrl: new Map(),
    tree,
    bookmarksBarId,
    bookmarksBarLabel,
    untitledFallback: t('common.untitled'),
  };

  return toDuplicateBookmarkScanJobSnapshot(activeDuplicateBookmarkScanJob);
}

async function runDuplicateBookmarkScanJobBatch(jobId: string): Promise<DuplicateBookmarkScanJobSnapshot> {
  const job = activeDuplicateBookmarkScanJob;
  if (!job || job.id !== jobId) {
    return {
      id: jobId,
      status: 'failed',
      totalBookmarksScanned: 0,
      scanned: 0,
      duplicateGroupCount: 0,
      groups: [],
      error: 'Job not found',
    };
  }
  if (job.status !== 'running') return toDuplicateBookmarkScanJobSnapshot(job);

  try {
    const end = Math.min(job.cursor + DUPLICATE_SCAN_BATCH_SIZE, job.bookmarkNodes.length);
    for (; job.cursor < end; job.cursor += 1) {
      const node = job.bookmarkNodes[job.cursor];
      job.scanned += 1;
      if (!node) continue;
      await collectDuplicateCandidate(job, node);
    }

    if (job.cursor >= job.bookmarkNodes.length) {
      job.status = 'completed';
    }
    return toDuplicateBookmarkScanJobSnapshot(job);
  } catch (error) {
    job.status = 'failed';
    job.error = error instanceof Error ? error.message : 'Unknown error';
    return toDuplicateBookmarkScanJobSnapshot(job);
  }
}

function cancelDuplicateBookmarkScanJob(jobId: string): DuplicateBookmarkScanJobSnapshot {
  const job = activeDuplicateBookmarkScanJob;
  if (!job || job.id !== jobId) {
    return {
      id: jobId,
      status: 'cancelled',
      totalBookmarksScanned: 0,
      scanned: 0,
      duplicateGroupCount: 0,
      groups: [],
    };
  }

  job.status = 'cancelled';
  return toDuplicateBookmarkScanJobSnapshot(job);
}

async function collectDuplicateCandidate(
  job: DuplicateBookmarkScanJob,
  node: BookmarkTreeNodeSnapshot,
): Promise<void> {
  if (!node.url) return;
  const normalizedUrl = normalizeBookmarkUrl(node.url);
  if (!normalizedUrl) return;
  const summaryRecord = await getBookmarkSummary(node.id);

  const items = job.groupsByUrl.get(normalizedUrl) ?? [];
  items.push({
    id: node.id,
    title: node.title?.trim() || job.untitledFallback,
    url: node.url,
    folderPath: getRelativeFolderPath(
      job.tree,
      job.bookmarksBarId,
      node.parentId ?? null,
      job.bookmarksBarLabel,
    ),
    hasSummary: Boolean(summaryRecord?.summary?.trim()),
  });
  job.groupsByUrl.set(normalizedUrl, items);
}

function toDuplicateBookmarkScanJobSnapshot(job: DuplicateBookmarkScanJob): DuplicateBookmarkScanJobSnapshot {
  const groups: DuplicateBookmarkGroup[] = [...job.groupsByUrl.entries()]
    .map(([normalizedUrl, items]) => toDuplicateGroup(normalizedUrl, items))
    .filter((group) => group.items.length > 1)
    .sort((a, b) => b.items.length - a.items.length || a.normalizedUrl.localeCompare(b.normalizedUrl))
    .slice(0, MAX_DUPLICATE_GROUPS);

  return {
    id: job.id,
    status: job.status,
    totalBookmarksScanned: job.totalBookmarksScanned,
    scanned: job.scanned,
    duplicateGroupCount: groups.length,
    groups,
    error: job.error,
  };
}

async function removeDuplicateBookmarks(
  bookmarkIds: string[],
  mergeSelections: DuplicateBookmarkMergeSelection[],
): Promise<{ removedCount: number }> {
  // Apply non-destructive merge metadata first, then delete selected copies.
  // Every performed change is recorded so the operation can be undone later.
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
  // The default plan keeps the best-looking candidate, suggests the best title,
  // and marks all other copies for removal. The UI can override keepBookmarkId.
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
  // Prefer records that preserve user-created value: saved summaries, readable
  // titles, and less deeply nested locations.
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
  // Heuristic title quality score. It rewards human-readable titles and
  // penalizes raw URLs or overly long page titles.
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
  // Before deleting duplicate copies, update the chosen keep item with the best
  // available title and summary so useful metadata is not lost.
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
  // Move one useful summary from a soon-to-be-deleted duplicate onto the kept
  // bookmark, but never overwrite an existing summary on the keep item.
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
