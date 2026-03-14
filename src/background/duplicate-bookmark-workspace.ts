import { normalizeBookmarkUrl, removeBookmarkSummary } from '@/src/shared/bookmark-summary';
import { createTranslator, getCurrentLocale } from '@/src/shared/i18n';
import { messaging } from '@/src/shared/messaging';
import { getResolvedSettings } from '@/src/shared/settings';
import type {
  BookmarkTreeNodeSnapshot,
  DuplicateBookmarkCandidate,
  DuplicateBookmarkGroup,
  DuplicateBookmarkPreview,
} from '@/src/shared/types';

import { getBookmarksBarId, getRelativeFolderPath } from './engine/helpers';

const MAX_DUPLICATE_GROUPS = 50;

export function initDuplicateBookmarkWorkspace(): void {
  messaging.onMessage('generateDuplicateBookmarkPreview', async () => {
    return await generateDuplicateBookmarkPreview();
  });

  messaging.onMessage('removeDuplicateBookmarks', async ({ data }) => {
    return await removeDuplicateBookmarks(data.bookmarkIds);
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
    });
    groupsByUrl.set(normalizedUrl, items);
  }

  const groups: DuplicateBookmarkGroup[] = [...groupsByUrl.entries()]
    .map(([normalizedUrl, items]) => ({
      normalizedUrl,
      url: items[0]?.url ?? normalizedUrl,
      items: items.sort((a, b) => a.folderPath.localeCompare(b.folderPath) || a.title.localeCompare(b.title)),
    }))
    .filter((group) => group.items.length > 1)
    .sort((a, b) => b.items.length - a.items.length || a.normalizedUrl.localeCompare(b.normalizedUrl))
    .slice(0, MAX_DUPLICATE_GROUPS);

  return {
    totalBookmarksScanned: bookmarkNodes.length,
    duplicateGroupCount: groups.length,
    groups,
  };
}

async function removeDuplicateBookmarks(bookmarkIds: string[]): Promise<{ removedCount: number }> {
  let removedCount = 0;

  for (const bookmarkId of bookmarkIds) {
    try {
      await browser.bookmarks.remove(bookmarkId);
      await removeBookmarkSummary(bookmarkId);
      removedCount += 1;
    } catch {
      // Ignore individual failures to keep batch removal going.
    }
  }

  return { removedCount };
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
