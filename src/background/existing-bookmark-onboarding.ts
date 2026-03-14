import { getBookmarkSuggestion } from '@/src/shared/bookmark-ai';
import { getBookmarkSummary, normalizeBookmarkUrl, setBookmarkSummary } from '@/src/shared/bookmark-summary';
import { createTranslator, getCurrentLocale } from '@/src/shared/i18n';
import { messaging } from '@/src/shared/messaging';
import { getResolvedSettings } from '@/src/shared/settings';
import type {
  BookmarkSummaryRecord,
  BookmarkTreeNodeSnapshot,
  ExistingBookmarkApplyActions,
  ExistingBookmarkSuggestionItem,
  ExistingBookmarkSuggestionPreview,
  PageContent,
} from '@/src/shared/types';

import { collectFolderPaths, getBookmarksBarId, getRelativeFolderPath } from './engine/helpers';

const MAX_PREVIEW_ITEMS = 20;
const PAGE_TEXT_LIMIT = 5000;

export function initExistingBookmarkOnboarding(): void {
  messaging.onMessage('generateExistingBookmarkPreview', async () => {
    return await generateExistingBookmarkPreview();
  });

  messaging.onMessage('applyExistingBookmarkPreview', async ({ data }) => {
    return await applyExistingBookmarkPreview(data);
  });
}

async function generateExistingBookmarkPreview(): Promise<ExistingBookmarkSuggestionPreview> {
  const settings = await getResolvedSettings();
  const locale = await getCurrentLocale(settings.raw);
  const { t } = createTranslator(locale);
  const configError = !settings.raw.aiBaseURL || !settings.raw.aiModel;
  if (configError) {
    return {
      totalBookmarksScanned: 0,
      suggestionCount: 0,
      suggestions: [],
    };
  }

  const tree = await browser.bookmarks.getTree();
  const bookmarksBarId = getBookmarksBarId(tree);
  const bookmarksBarLabel = t('common.bookmarksBar');
  const folderPaths = collectFolderPaths(tree, bookmarksBarId);
  const bookmarkNodes = flattenBookmarkNodes(tree);
  const suggestions: ExistingBookmarkSuggestionItem[] = [];

  for (const node of bookmarkNodes) {
    if (!node.url) continue;
    if (!/^https?:\/\//i.test(node.url)) continue;
    if (suggestions.length >= MAX_PREVIEW_ITEMS) break;

    const pageContent = toPreviewPageContent(node);
    const suggestion = await getBookmarkSuggestion({
      settings: settings.raw,
      locale,
      url: node.url,
      originalTitle: node.title ?? '',
      pageContent,
      folderPaths,
      summaryEnabled: settings.features.summary.enabled,
      untitledFallback: t('common.untitled'),
    });

    if (!suggestion) continue;

    const currentFolderPath = getRelativeFolderPath(
      tree,
      bookmarksBarId,
      node.parentId ?? null,
      bookmarksBarLabel,
    );

    if (
      suggestion.suggestedFolder === currentFolderPath ||
      suggestion.suggestedFolder === '' && currentFolderPath === bookmarksBarLabel
    ) {
      if (suggestion.title.trim() === (node.title ?? '').trim()) {
        continue;
      }
    }

    suggestions.push({
      bookmarkId: node.id,
      url: node.url,
      originalTitle: node.title ?? '',
      currentFolderPath,
      suggestedFolder: suggestion.suggestedFolder,
      suggestedTitle: suggestion.title,
      confidence: suggestion.confidence,
      summary: suggestion.summary,
    });
  }

  return {
    totalBookmarksScanned: bookmarkNodes.length,
    suggestionCount: suggestions.length,
    suggestions,
  };
}

async function applyExistingBookmarkPreview(input: {
  preview: ExistingBookmarkSuggestionPreview;
  actions: ExistingBookmarkApplyActions;
},
): Promise<{ appliedCount: number }> {
  const { preview, actions } = input;
  const settings = await getResolvedSettings();
  const locale = await getCurrentLocale(settings.raw);
  const { t } = createTranslator(locale);
  const tree = await browser.bookmarks.getTree();
  const bookmarksBarId = getBookmarksBarId(tree);
  if (!bookmarksBarId) return { appliedCount: 0 };

  let appliedCount = 0;

  for (const item of preview.suggestions) {
    try {
      const [bookmark] = await browser.bookmarks.get(item.bookmarkId);
      if (!bookmark?.url) continue;

      if (actions.moveToFolder) {
        const parentId = await findOrCreateFolderPath(bookmarksBarId, item.suggestedFolder);
        await browser.bookmarks.move(item.bookmarkId, { parentId });
      }

      if (actions.renameTitle) {
        await browser.bookmarks.update(item.bookmarkId, { title: item.suggestedTitle });
      }

      if (actions.updateSummary && settings.features.summary.enabled && item.summary.trim()) {
        const normalizedUrl = normalizeBookmarkUrl(bookmark.url);
        if (normalizedUrl) {
          const existing = await getBookmarkSummary(item.bookmarkId);
          const now = Date.now();
          const folderPath = actions.moveToFolder
            ? item.suggestedFolder || t('common.bookmarksBar')
            : getRelativeFolderPath(
                tree,
                bookmarksBarId,
                bookmark.parentId ?? null,
                t('common.bookmarksBar'),
              );
          const record: BookmarkSummaryRecord = {
            bookmarkId: item.bookmarkId,
            url: bookmark.url,
            normalizedUrl,
            title: actions.renameTitle ? item.suggestedTitle : bookmark.title ?? item.originalTitle,
            folderPath,
            summary: item.summary.trim(),
            createdAt: existing?.createdAt ?? now,
            updatedAt: now,
          };
          await setBookmarkSummary(record);
        }
      }

      appliedCount += 1;
    } catch {
      // Ignore individual bookmark failures to keep the batch flowing.
    }
  }

  return { appliedCount };
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

function toPreviewPageContent(node: BookmarkTreeNodeSnapshot): PageContent {
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

async function findOrCreateFolderPath(bookmarksBarId: string, folderPath: string): Promise<string> {
  const parts = folderPath
    .split('-')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);

  if (parts.length === 0) return bookmarksBarId;

  let currentParentId = bookmarksBarId;
  for (const part of parts) {
    const children = await browser.bookmarks.getChildren(currentParentId);
    const existing = children.find((child) => !child.url && child.title === part);
    if (existing) {
      currentParentId = existing.id;
      continue;
    }

    const created = await browser.bookmarks.create({ parentId: currentParentId, title: part });
    currentParentId = created.id;
  }

  return currentParentId;
}
